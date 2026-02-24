/**
 * Gatilho de Recompra Inteligente
 *
 * Detecta o momento certo (dia 25) para propor a recompra
 * antes que o produto acabe, usando a psicologia da continuidade.
 */

import { createLogger } from '../lib/logger.js';
import { db } from '../database/client.js';
import { sendText } from '../channels/whatsapp-client.js';
import { enqueueSend } from '../safety/rate-limiter.js';

const logger = createLogger('REORDER');

// ============================================================
// CONSTRUIR MENSAGEM DE RECOMPRA (personalizada por perfil)
// ============================================================
function buildReorderMessage(params: {
  name?: string;
  product: string;
  streak: number;
  daysActive: number;
  weightLost?: number;
}): string {
  const firstName = params.name?.split(' ')[0] ?? 'você';
  const conquista = params.weightLost && params.weightLost > 0
    ? `Você já perdeu *${params.weightLost.toFixed(1)}kg*!`
    : `Você está com *${params.streak} dias de streak*!`;

  return [
    `${firstName}, olha só onde você chegou! 🌟`,
    ``,
    conquista,
    `*${params.daysActive} dias de consistência* — isso é incrível.`,
    ``,
    `Seu kit de *${params.product}* está chegando no fim.`,
    ``,
    `⚠️ *Se parar agora*, você perde o ritmo que levou`,
    `*${params.streak} dias* pra construir.`,
    ``,
    `Posso já garantir o kit do próximo mês pra você?`,
    `Assim a entrega chega antes de acabar — sem pausar sua transformação.`,
    ``,
    `Confirma com *SIM* e eu processo agora! 💚`,
  ].join('\n');
}

// ============================================================
// PROCESSAR GATILHO DE RECOMPRA
// Chamado pelo scheduler no dia 25 de cada projeto ativo
// ============================================================
export async function checkAndTriggerReorders(): Promise<void> {
  logger.info('Verificando gatilhos de recompra (dia 25)...');

  type ProjectRow = {
    id: string;
    start_date: string;
    product_kit: string;
    notes: string | null;
    leads: { phone: string | null; full_name: string | null };
    client_gamification: Array<{ current_streak: number; xp_total: number }>;
    start_weight_kg: number | null;
    current_weight_kg: number | null;
  };

  const { data: projects } = await db.client
    .from('client_projects')
    .select(`
      id,
      start_date,
      product_kit,
      notes,
      start_weight_kg,
      current_weight_kg,
      leads!inner(phone, full_name),
      client_gamification(current_streak, xp_total)
    `)
    .eq('status', 'active');

  if (!projects?.length) return;

  let triggered = 0;

  for (const proj of (projects as unknown) as ProjectRow[]) {
    const lead = proj.leads;
    if (!lead?.phone) continue;

    const startDate = new Date(proj.start_date);
    const daysActive = Math.floor((Date.now() - startDate.getTime()) / (24 * 60 * 60 * 1000));

    // Disparar apenas no dia 25 (janela de 25-26 dias)
    if (daysActive < 25 || daysActive > 26) continue;

    // Verificar se já foi disparado
    const notesData = proj.notes ? JSON.parse(proj.notes) as Record<string, unknown> : {};
    if (notesData.reorder_triggered) continue;

    const gam = proj.client_gamification?.[0];
    const weightLost = proj.start_weight_kg && proj.current_weight_kg
      ? proj.start_weight_kg - proj.current_weight_kg
      : undefined;

    const message = buildReorderMessage({
      name: lead.full_name ?? undefined,
      product: proj.product_kit,
      streak: gam?.current_streak ?? 0,
      daysActive,
      weightLost,
    });

    const phone = lead.phone;
    enqueueSend(phone, async () => {
      await sendText(phone, message);
      logger.info(`Gatilho de recompra disparado para ${phone.substring(0, 6)}... (dia ${daysActive})`);
    });

    // Marcar como disparado
    await db.client
      .from('client_projects')
      .update({
        notes: JSON.stringify({ ...notesData, reorder_triggered: true, reorder_triggered_at: new Date().toISOString() }),
      })
      .eq('id', proj.id);

    triggered++;
  }

  if (triggered > 0) {
    logger.info(`${triggered} gatilhos de recompra disparados`);
  }
}

// ============================================================
// PROCESSAR CONFIRMAÇÃO DE RECOMPRA (lead respondeu SIM)
// ============================================================
export async function processReorderConfirmation(
  leadId: string,
  consultantId: string,
  leadPhone: string
): Promise<void> {
  // Buscar o projeto ativo
  const { data: project } = await db.client
    .from('client_projects')
    .select('id, product_kit, lead_id')
    .eq('lead_id', leadId)
    .eq('status', 'active')
    .single();

  if (!project) return;
  const proj = project as { id: string; product_kit: string; lead_id: string };

  // Notificar consultor para processar o pedido
  const { data: consultant } = await db.client
    .from('consultants')
    .select('phone, name')
    .eq('id', consultantId)
    .single();

  const cons = consultant as { phone: string; name: string } | null;
  if (!cons) return;

  const notification = [
    `🔄 *RECOMPRA CONFIRMADA!*`,
    ``,
    `Lead confirmou recompra via bot!`,
    `📱 Número: +${leadPhone}`,
    `📦 Produto: ${proj.product_kit}`,
    ``,
    `Entre em contato para fechar o pedido. 💰`,
  ].join('\n');

  enqueueSend(cons.phone, async () => {
    await sendText(cons.phone, notification);
  });

  // Confirmar para o lead
  enqueueSend(leadPhone, async () => {
    await sendText(
      leadPhone,
      `✅ *Perfeito! Já anotei o seu pedido.*\n\n${cons.name} vai entrar em contato em breve para confirmar o endereço de entrega e os detalhes.\n\nContinue firme nos próximos dias — você está fazendo histórico! 🏆`
    );
  });

  logger.info(`Recompra confirmada: lead ${leadId}, produto ${proj.product_kit}`);
}
