/**
 * API de Métricas para o Dashboard do Consultor
 *
 * Fornece dados em tempo real sobre:
 * - Funil de conversão (leads → prospects → clientes)
 * - Gamificação (top clientes, streaks, XP)
 * - Prospects da fila social
 * - Performance das réguas e check-ins
 */

import { createLogger } from '../lib/logger.js';
import { db } from '../database/client.js';
import { getQueueStats } from '../monitor/prospect-queue.js';

const logger = createLogger('DASHBOARD');

// ============================================================
// TIPOS DE RESPOSTA
// ============================================================
export type FunnelMetrics = {
  totalLeads: number;
  activeConversations: number;
  convertedClients: number;
  conversionRate: number;  // %
  avgDaysToConvert: number;
};

export type ClientOverview = {
  projectId: string;
  leadName: string;
  leadPhone: string;
  productKit: string;
  daysActive: number;
  currentStreak: number;
  xpTotal: number;
  level: number;
  lastCheckin?: string;
};

export type DashboardSummary = {
  consultantId: string;
  consultantName: string;
  period: string;
  funnel: FunnelMetrics;
  topClients: ClientOverview[];
  prospectQueue: {
    total: number;
    hot: number;
    warm: number;
    queued: number;
  };
  todayStats: {
    checkinsSent: number;
    messagesProcessed: number;
    reordersTrigered: number;
  };
  generatedAt: string;
};

// ============================================================
// CALCULAR NÍVEL A PARTIR DO XP
// (deve estar em sincronia com gamification.ts)
// ============================================================
function xpToLevel(xp: number): number {
  const thresholds = [0, 100, 300, 600, 1000, 1500, 2500, 4000];
  let level = 1;
  for (let i = 0; i < thresholds.length; i++) {
    if (xp >= thresholds[i]) level = i + 1;
    else break;
  }
  return level;
}

// ============================================================
// BUSCAR MÉTRICAS DO FUNIL
// ============================================================
async function getFunnelMetrics(consultantId: string): Promise<FunnelMetrics> {
  // Total de leads
  const { count: totalLeads } = await db.client
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('consultant_id', consultantId);

  // Conversas ativas
  const { count: activeConversations } = await db.client
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('consultant_id', consultantId)
    .eq('status', 'active');

  // Clientes convertidos (projetos ativos)
  const { count: convertedClients } = await db.client
    .from('client_projects')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active');

  // Taxa de conversão
  const total = totalLeads ?? 0;
  const converted = convertedClients ?? 0;
  const conversionRate = total > 0 ? Math.round((converted / total) * 100) : 0;

  return {
    totalLeads: total,
    activeConversations: activeConversations ?? 0,
    convertedClients: converted,
    conversionRate,
    avgDaysToConvert: 4, // Placeholder — calcular de dados reais em produção
  };
}

// ============================================================
// BUSCAR TOP CLIENTES (por XP e streak)
// ============================================================
async function getTopClients(
  consultantId: string,
  limit = 10
): Promise<ClientOverview[]> {
  const { data: projects } = await db.client
    .from('client_projects')
    .select(`
      id,
      product_kit,
      start_date,
      leads!inner(phone, full_name, consultant_id),
      client_gamification(current_streak, xp_total, last_checkin_date)
    `)
    .eq('status', 'active')
    .eq('leads.consultant_id', consultantId);

  if (!projects?.length) return [];

  type ProjRow = {
    id: string;
    product_kit: string;
    start_date: string;
    leads: { phone: string | null; full_name: string | null; consultant_id: string };
    client_gamification: Array<{ current_streak: number; xp_total: number; last_checkin_date: string | null }>;
  };

  return ((projects as unknown) as ProjRow[])
    .map(p => {
      const gam = p.client_gamification?.[0];
      const daysActive = Math.floor(
        (Date.now() - new Date(p.start_date).getTime()) / (24 * 60 * 60 * 1000)
      );
      return {
        projectId: p.id,
        leadName: p.leads.full_name ?? 'Sem nome',
        leadPhone: p.leads.phone ?? '',
        productKit: p.product_kit,
        daysActive,
        currentStreak: gam?.current_streak ?? 0,
        xpTotal: gam?.xp_total ?? 0,
        level: xpToLevel(gam?.xp_total ?? 0),
        lastCheckin: gam?.last_checkin_date ?? undefined,
      } satisfies ClientOverview;
    })
    .sort((a, b) => b.xpTotal - a.xpTotal)
    .slice(0, limit);
}

// ============================================================
// RESUMO COMPLETO DO DASHBOARD
// ============================================================
export async function getDashboardSummary(
  consultantId: string
): Promise<DashboardSummary> {
  logger.debug(`Gerando dashboard para consultor ${consultantId.substring(0, 8)}...`);

  // Buscar nome do consultor
  const { data: consultant } = await db.client
    .from('consultants')
    .select('name')
    .eq('id', consultantId)
    .single();

  const consultantName = (consultant as { name: string } | null)?.name ?? 'Consultor';

  // Buscar todos os dados em paralelo
  const [funnel, topClients] = await Promise.all([
    getFunnelMetrics(consultantId),
    getTopClients(consultantId),
  ]);

  const prospectStats = getQueueStats(consultantId);

  return {
    consultantId,
    consultantName,
    period: new Date().toISOString().split('T')[0],
    funnel,
    topClients,
    prospectQueue: {
      total: prospectStats.total,
      hot: prospectStats.hot,
      warm: prospectStats.warm,
      queued: prospectStats.queued,
    },
    todayStats: {
      // Em produção: buscar de tabela daily_metrics
      checkinsSent: 0,
      messagesProcessed: 0,
      reordersTrigered: 0,
    },
    generatedAt: new Date().toISOString(),
  };
}

// ============================================================
// MÉTRICAS HISTÓRICAS (últimos N dias)
// ============================================================
export async function getHistoricalMetrics(
  consultantId: string,
  days = 30
): Promise<Array<{ date: string; leads: number; conversions: number; checkins: number }>> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // Buscar leads por dia
  const { data: leadsData } = await db.client
    .from('leads')
    .select('created_at')
    .eq('consultant_id', consultantId)
    .gte('created_at', since);

  // Agrupar por dia
  const byDay = new Map<string, { leads: number; conversions: number; checkins: number }>();

  for (const lead of (leadsData ?? []) as Array<{ created_at: string }>) {
    const day = lead.created_at.split('T')[0];
    if (!byDay.has(day)) byDay.set(day, { leads: 0, conversions: 0, checkins: 0 });
    byDay.get(day)!.leads++;
  }

  // Converter para array ordenado
  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, metrics]) => ({ date, ...metrics }));
}

// ============================================================
// GERAR RELATÓRIO DIÁRIO PARA O CONSULTOR (via WhatsApp)
// ============================================================
export async function buildDailyReportMessage(consultantId: string): Promise<string> {
  const summary = await getDashboardSummary(consultantId);

  const lines = [
    `📊 *Relatório Diário — PELÍCANO*`,
    ``,
    `👥 *Funil de Conversão:*`,
    `   Leads totais: ${summary.funnel.totalLeads}`,
    `   Conversas ativas: ${summary.funnel.activeConversations}`,
    `   Clientes ativos: ${summary.funnel.convertedClients}`,
    `   Taxa de conversão: ${summary.funnel.conversionRate}%`,
    ``,
  ];

  if (summary.prospectQueue.hot > 0) {
    lines.push(
      `🔥 *Prospects Quentes:* ${summary.prospectQueue.hot} pessoa(s) aguardando abordagem!`,
      ``
    );
  }

  if (summary.topClients.length > 0) {
    lines.push(`🏆 *Top 3 Clientes Hoje:*`);
    const top3 = summary.topClients.slice(0, 3);
    for (const c of top3) {
      lines.push(
        `   ${c.leadName} — Nível ${c.level} | Streak: ${c.currentStreak}🔥 | ${c.xpTotal}XP`
      );
    }
    lines.push(``);
  }

  lines.push(
    `_Acesse o painel para detalhes completos._`,
    ``,
    `🦅 *PELÍCANO™ by Herbalife Assistant*`
  );

  return lines.join('\n');
}
