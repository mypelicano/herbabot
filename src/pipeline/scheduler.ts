/**
 * Scheduler de Réguas de Mensagens
 * Roda a cada hora e despacha mensagens pendentes das réguas
 */

import cron from 'node-cron';
import { createLogger } from '../lib/logger.js';
import { db } from '../database/client.js';
import { sendText } from '../channels/whatsapp-client.js';
import { enqueueSend } from '../safety/rate-limiter.js';
import {
  getMessagesForToday,
  type SequenceParams,
} from './followup-sequences.js';
import { dispatchDailyCheckins } from '../engine/checkin-flow.js';
import { checkAndTriggerReorders } from './reorder-trigger.js';
import { processActiveGroups } from './challenge-groups.js';
import { notifyConsultantAboutProspects } from '../monitor/prospect-queue.js';
import { buildDailyReportMessage } from '../dashboard/metrics.js';

const logger = createLogger('SCHEDULER');

// ============================================================
// PROCESSAR RÉGUA DE FOLLOW-UP (leads não convertidos)
// ============================================================
async function processFollowupSequence(): Promise<void> {
  logger.info('Processando régua de follow-up...');

  // Busca leads com conversa ativa há mais de 1 dia mas sem conversão
  const { data: activeLeads } = await db.client
    .from('conversations')
    .select(`
      id,
      lead_id,
      consultant_id,
      started_at,
      context_data,
      leads!inner(phone, full_name)
    `)
    .eq('status', 'active')
    .lt('started_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  if (!activeLeads?.length) return;

  type ConvRow = {
    id: string;
    lead_id: string;
    consultant_id: string;
    started_at: string;
    context_data: Record<string, unknown>;
    leads: { phone: string | null; full_name: string | null };
  };

  for (const conv of (activeLeads as unknown) as ConvRow[]) {
    const lead = conv.leads;
    if (!lead?.phone) continue;

    const context = conv.context_data as Record<string, unknown>;
    const sentDays: number[] = (context.followup_sent_days as number[]) ?? [];
    const startDate = new Date(conv.started_at);

    const pendingMessages = getMessagesForToday('followup', startDate, sentDays);

    for (const msg of pendingMessages) {
      const params: SequenceParams = {
        name: (lead.full_name ?? context.name) as string | undefined,
        pain: ((context.pain_points as string[]) ?? [])[0],
      };

      const text = msg.getText(params);
      const phone = lead.phone;

      enqueueSend(phone, async () => {
        await sendText(phone, text);
        logger.info(`Follow-up D+${msg.dayOffset} enviado para ${phone.substring(0, 6)}...`);
      });

      sentDays.push(msg.dayOffset);
    }

    if (pendingMessages.length > 0) {
      // Registrar os dias enviados no contexto
      await db.conversations.update(conv.id, {
        context_data: { ...context, followup_sent_days: sentDays } as import('../database/client.js').LeadContextData,
      });
    }
  }
}

// ============================================================
// PROCESSAR RÉGUA PÓS-COMPRA (clientes ativos)
// ============================================================
async function processPostPurchaseSequence(): Promise<void> {
  logger.info('Processando régua pós-compra...');

  const { data: activeProjects } = await db.client
    .from('client_projects')
    .select(`
      id,
      lead_id,
      product_kit,
      start_date,
      notes,
      leads!inner(phone, full_name),
      client_gamification(current_streak, xp_total)
    `)
    .eq('status', 'active');

  if (!activeProjects?.length) return;

  type ProjectRow = {
    id: string;
    lead_id: string;
    product_kit: string;
    start_date: string;
    notes: string | null;
    leads: { phone: string | null; full_name: string | null };
    client_gamification: Array<{ current_streak: number; xp_total: number }>;
  };

  for (const project of (activeProjects as unknown) as ProjectRow[]) {
    const lead = project.leads;
    if (!lead?.phone) continue;

    const gamification = project.client_gamification?.[0];
    const notesData = project.notes ? JSON.parse(project.notes) as Record<string, unknown> : {};
    const sentDays: number[] = (notesData.postpurchase_sent_days as number[]) ?? [];
    const startDate = new Date(project.start_date);

    const pendingMessages = getMessagesForToday('postpurchase', startDate, sentDays);

    for (const msg of pendingMessages) {
      const params: SequenceParams = {
        name: lead.full_name ?? undefined,
        product: project.product_kit,
        streak: gamification?.current_streak ?? 0,
      };

      const text = msg.getText(params);
      const phone = lead.phone;

      enqueueSend(phone, async () => {
        await sendText(phone, text);
        logger.info(`Pós-compra D+${msg.dayOffset} enviado para ${phone.substring(0, 6)}...`);
      });

      sentDays.push(msg.dayOffset);
    }

    if (pendingMessages.length > 0) {
      await db.client
        .from('client_projects')
        .update({
          notes: JSON.stringify({ ...notesData, postpurchase_sent_days: sentDays }),
        })
        .eq('id', project.id);
    }
  }
}

// ============================================================
// INICIALIZAR AGENDAMENTOS
// ============================================================
// ============================================================
// ENVIAR RELATÓRIO DIÁRIO PARA TODOS OS CONSULTORES
// Mensagem matinal com métricas do dia anterior
// ============================================================
async function sendDailyReports(): Promise<void> {
  logger.info('Enviando relatórios diários para consultores...');

  const { data: consultants } = await db.client
    .from('consultants')
    .select('id, phone')
    .eq('active', true);

  if (!consultants?.length) return;

  for (const c of consultants as Array<{ id: string; phone: string }>) {
    if (!c.phone) continue;
    try {
      const report = await buildDailyReportMessage(c.id);
      enqueueSend(c.phone, async () => {
        await sendText(c.phone, report);
      });
    } catch (err) {
      logger.error(`Erro ao enviar relatório para consultor ${c.id}`, err);
    }
  }
}

// ============================================================
// NOTIFICAR CONSULTORES SOBRE PROSPECTS QUENTES
// Busca todos consultores ativos e notifica sobre fila
// ============================================================
async function dispatchProspectNotifications(): Promise<void> {
  logger.info('Verificando prospects quentes para notificar consultores...');

  const { data: consultants } = await db.client
    .from('consultants')
    .select('id')
    .eq('active', true);

  if (!consultants?.length) return;

  for (const c of consultants as Array<{ id: string }>) {
    await notifyConsultantAboutProspects(c.id).catch(err =>
      logger.error(`Erro ao notificar consultor ${c.id}`, err)
    );
  }
}

export function startScheduler(): void {
  logger.info('Iniciando scheduler completo (Fases 2 + 3 + 4 + 5)...');

  // 07:00 — Relatório diário para consultores
  cron.schedule('0 7 * * *', async () => {
    try {
      logger.info('[CRON 7h] Enviando relatórios diários...');
      await sendDailyReports();
    } catch (error) {
      logger.error('Erro no cron 7h', error);
    }
  });

  // 08:00 — Check-ins diários + bom dia nos grupos + follow-up leads
  cron.schedule('0 8 * * *', async () => {
    try {
      logger.info('[CRON 8h] Disparando check-ins, bom dias e prospects...');
      await dispatchDailyCheckins();
      await processActiveGroups();
      await processFollowupSequence();
      await dispatchProspectNotifications();
    } catch (error) {
      logger.error('Erro no cron 8h', error);
    }
  });

  // 11:00 — Régua pós-compra + gatilho de recompra
  cron.schedule('0 11 * * *', async () => {
    try {
      logger.info('[CRON 11h] Régua pós-compra + gatilho recompra...');
      await processPostPurchaseSequence();
      await checkAndTriggerReorders();
    } catch (error) {
      logger.error('Erro no cron 11h', error);
    }
  });

  // 14:00 — Segunda rodada de notificações de prospects
  cron.schedule('0 14 * * *', async () => {
    try {
      logger.info('[CRON 14h] Notificações de prospects...');
      await dispatchProspectNotifications();
    } catch (error) {
      logger.error('Erro no cron 14h', error);
    }
  });

  // 20:00 — Boa noite nos grupos
  cron.schedule('0 20 * * *', async () => {
    try {
      logger.info('[CRON 20h] Mensagens noturnas nos grupos...');
      await processActiveGroups();
    } catch (error) {
      logger.error('Erro no cron 20h', error);
    }
  });

  logger.info('Scheduler iniciado: 5 janelas (7h, 8h, 11h, 14h, 20h)');
}
