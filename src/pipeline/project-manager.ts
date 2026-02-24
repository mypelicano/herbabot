/**
 * Gerenciador de Projetos de Cliente
 * Cria e gerencia o projeto personalizado de cada cliente pós-venda.
 * É o coração da Fase 3 — transforma um lead em cliente com jornada ativa.
 */

import { createLogger } from '../lib/logger.js';
import { db } from '../database/client.js';
import { sendText } from '../channels/whatsapp-client.js';
import { enqueueSend } from '../safety/rate-limiter.js';
import type { ClientProject } from '../database/client.js';

const logger = createLogger('PROJECTS');

// ============================================================
// KITS DE PRODUTOS HERBALIFE (catálogo simplificado)
// ============================================================
export const PRODUCT_KITS = {
  WEIGHT_LOSS_BASIC: {
    id: 'weight_loss_basic',
    name: 'Kit Controle de Peso',
    description: 'Formula 1 + Herbal Tea + Aloe',
    durationDays: 30,
    goalType: 'weight_loss' as const,
  },
  WEIGHT_LOSS_COMPLETE: {
    id: 'weight_loss_complete',
    name: 'Kit Transformação Completo',
    description: 'Formula 1 + Proteína + Herbal Tea + Aloe + Vitaminas',
    durationDays: 30,
    goalType: 'weight_loss' as const,
  },
  ENERGY: {
    id: 'energy',
    name: 'Kit Energia e Vitalidade',
    description: 'Herbal Tea + Formula 1 + Vitaminas',
    durationDays: 30,
    goalType: 'energy' as const,
  },
  PERFORMANCE: {
    id: 'performance',
    name: 'Kit Performance Herbalife24',
    description: 'H24 Rebuild + CR7 Drive + Formula 1 Pro',
    durationDays: 30,
    goalType: 'performance' as const,
  },
} as const;

export type KitId = keyof typeof PRODUCT_KITS;

// ============================================================
// CRIAR PROJETO PÓS-VENDA
// Chamado quando lead é convertido em cliente
// ============================================================
export async function createClientProject(params: {
  leadId: string;
  consultantId: string;
  kitId: KitId;
  goalDescription: string;
  startWeightKg?: number;
  targetWeightKg?: number;
  leadPhone: string;
  leadName?: string;
}): Promise<ClientProject> {
  const kit = PRODUCT_KITS[params.kitId];

  // Calcular data alvo (30 dias por padrão)
  const startDate = new Date();
  const targetDate = new Date(startDate.getTime() + kit.durationDays * 24 * 60 * 60 * 1000);

  // Criar projeto no banco
  const { data: project, error } = await db.client
    .from('client_projects')
    .insert({
      lead_id: params.leadId,
      consultant_id: params.consultantId,
      product_kit: kit.name,
      goal_description: params.goalDescription,
      goal_type: kit.goalType,
      start_weight_kg: params.startWeightKg ?? null,
      current_weight_kg: params.startWeightKg ?? null,
      target_weight_kg: params.targetWeightKg ?? null,
      start_date: startDate.toISOString().split('T')[0],
      target_date: targetDate.toISOString().split('T')[0],
      status: 'active',
      notes: JSON.stringify({ postpurchase_sent_days: [] }),
    })
    .select()
    .single();

  if (error || !project) {
    throw new Error(`Erro ao criar projeto: ${error?.message}`);
  }

  const clientProject = project as ClientProject;

  // Criar gamificação inicial
  await db.client.from('client_gamification').insert({
    project_id: clientProject.id,
    xp_total: 0,
    level: 1,
    current_streak: 0,
    max_streak: 0,
    checkin_count_total: 0,
    checkin_count_30d: 0,
    last_checkin_at: null,
    badges: [],
  });

  logger.info(`Projeto criado para lead ${params.leadId}: ${kit.name}`);

  // Enviar mensagem de boas-vindas ao projeto
  const welcomeMsg = buildWelcomeMessage({
    name: params.leadName,
    kitName: kit.name,
    goalDescription: params.goalDescription,
    targetDate: targetDate.toLocaleDateString('pt-BR'),
  });

  enqueueSend(params.leadPhone, async () => {
    await sendText(params.leadPhone, welcomeMsg);
  });

  return clientProject;
}

// ============================================================
// MENSAGEM DE BOAS-VINDAS AO PROJETO
// ============================================================
function buildWelcomeMessage(params: {
  name?: string;
  kitName: string;
  goalDescription: string;
  targetDate: string;
}): string {
  const firstName = params.name?.split(' ')[0] ?? 'você';
  return [
    `🌟 *Bem-vinda ao seu Projeto de Transformação, ${firstName}!*`,
    ``,
    `Acabei de montar o seu plano personalizado:`,
    ``,
    `📦 *Kit:* ${params.kitName}`,
    `🎯 *Seu objetivo:* ${params.goalDescription}`,
    `📅 *Meta:* ${params.targetDate}`,
    ``,
    `*Seu plano dos primeiros 7 dias:*`,
    ``,
    `☀️ *Manhã (antes de sair):*`,
    `   → 1 shake Formula 1 (água ou leite desnatado)`,
    `   → 1 copo de chá concentrado (200ml)`,
    ``,
    `🍽️ *Almoço:* refeição normal e balanceada`,
    ``,
    `🌙 *Noite:*`,
    `   → 1 shake leve ou refeição normal`,
    ``,
    `💧 *Água:* no mínimo 2 litros por dia`,
    ``,
    `*Todo dia você vai receber seu check-in aqui pelo WhatsApp.*`,
    `É simples e rápido — só responder ✅ ou ❌ pra cada item.`,
    ``,
    `Me conta: o kit chegou ou você ainda está aguardando entrega? 📦`,
  ].join('\n');
}

// ============================================================
// BUSCAR PROJETO ATIVO DE UM LEAD
// ============================================================
export async function getActiveProject(leadId: string): Promise<ClientProject | null> {
  const { data } = await db.client
    .from('client_projects')
    .select('*')
    .eq('lead_id', leadId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  return (data as ClientProject | null);
}

// ============================================================
// ATUALIZAR PESO ATUAL DO CLIENTE
// ============================================================
export async function updateClientWeight(
  projectId: string,
  weightKg: number
): Promise<{ lost: number | null }> {
  // Buscar peso inicial
  const { data: project } = await db.client
    .from('client_projects')
    .select('start_weight_kg, current_weight_kg')
    .eq('id', projectId)
    .single();

  const proj = project as { start_weight_kg: number | null; current_weight_kg: number | null } | null;

  await db.client
    .from('client_projects')
    .update({ current_weight_kg: weightKg })
    .eq('id', projectId);

  const lost = proj?.start_weight_kg
    ? Math.round((proj.start_weight_kg - weightKg) * 10) / 10
    : null;

  logger.info(`Peso atualizado no projeto ${projectId}: ${weightKg}kg (perdeu ${lost ?? '?'}kg)`);
  return { lost };
}

// ============================================================
// MARCAR PROJETO COMO CONVERTIDO (RECOMPRA)
// ============================================================
export async function markProjectReorder(projectId: string): Promise<void> {
  await db.client
    .from('client_projects')
    .update({ status: 'completed' })
    .eq('id', projectId);

  logger.info(`Projeto ${projectId} marcado como recompra/concluído`);
}
