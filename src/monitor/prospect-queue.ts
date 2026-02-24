/**
 * Fila de Prospecção Inteligente
 *
 * Armazena e prioriza prospects detectados pelo monitor social.
 * Cada consultor tem sua própria fila. O PELÍCANO aborda
 * automaticamente os HOT leads e notifica o consultor dos WARM/COLD.
 */

import { createLogger } from '../lib/logger.js';
import { db } from '../database/client.js';
import { sendText } from '../channels/whatsapp-client.js';
import { enqueueSend, isWithinAllowedHours } from '../safety/rate-limiter.js';
import { type SocialSignal } from './social-listener.js';

const logger = createLogger('PROSPECT-QUEUE');

// ============================================================
// TIPOS
// ============================================================
export type ProspectEntry = {
  id: string;
  consultantId: string;
  signal: SocialSignal;
  status: 'queued' | 'approaching' | 'contacted' | 'converted' | 'ignored';
  approachedAt?: Date;
  contactedPhone?: string;
  notes?: string;
  createdAt: Date;
};

// Armazenamento em memória (em produção: persistir no Supabase)
const prospectQueues = new Map<string, ProspectEntry[]>(); // key: consultantId

// ============================================================
// ADICIONAR PROSPECT À FILA
// ============================================================
export function enqueueProspect(params: {
  consultantId: string;
  signal: SocialSignal;
}): ProspectEntry {
  const { consultantId, signal } = params;

  if (!prospectQueues.has(consultantId)) {
    prospectQueues.set(consultantId, []);
  }

  const queue = prospectQueues.get(consultantId)!;

  // Evitar duplicatas (mesmo profileId da mesma plataforma nas últimas 24h)
  const alreadyQueued = queue.some(
    p =>
      p.signal.profileId === signal.profileId &&
      p.signal.platform === signal.platform &&
      Date.now() - p.createdAt.getTime() < 24 * 60 * 60 * 1000
  );

  if (alreadyQueued) {
    logger.debug(`Prospect ${signal.profileId} já está na fila — ignorando duplicata`);
    return queue.find(p => p.signal.profileId === signal.profileId)!;
  }

  const entry: ProspectEntry = {
    id: `pq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    consultantId,
    signal,
    status: 'queued',
    createdAt: new Date(),
  };

  // Inserir em ordem de prioridade (hot primeiro)
  const priorityOrder = { hot: 0, warm: 1, cold: 2 };
  const insertIdx = queue.findIndex(
    p => priorityOrder[p.signal.priority] > priorityOrder[signal.priority]
  );

  if (insertIdx === -1) {
    queue.push(entry);
  } else {
    queue.splice(insertIdx, 0, entry);
  }

  logger.info(
    `Prospect enfileirado [${signal.priority.toUpperCase()}]: @${signal.profileId} (${signal.platform}) — consultor ${consultantId.substring(0, 8)}...`
  );

  return entry;
}

// ============================================================
// OBTER PRÓXIMOS DA FILA
// ============================================================
export function getNextProspects(consultantId: string, limit = 5): ProspectEntry[] {
  const queue = prospectQueues.get(consultantId) ?? [];
  return queue
    .filter(p => p.status === 'queued')
    .slice(0, limit);
}

// ============================================================
// ATUALIZAR STATUS DO PROSPECT
// ============================================================
export function updateProspectStatus(
  consultantId: string,
  prospectId: string,
  status: ProspectEntry['status'],
  extras?: { contactedPhone?: string; notes?: string }
): void {
  const queue = prospectQueues.get(consultantId);
  if (!queue) return;

  const entry = queue.find(p => p.id === prospectId);
  if (!entry) return;

  entry.status = status;
  if (extras?.contactedPhone) entry.contactedPhone = extras.contactedPhone;
  if (extras?.notes) entry.notes = extras.notes;
  if (status === 'approaching') entry.approachedAt = new Date();
}

// ============================================================
// ESTATÍSTICAS DA FILA
// ============================================================
export function getQueueStats(consultantId: string) {
  const queue = prospectQueues.get(consultantId) ?? [];
  return {
    total: queue.length,
    queued: queue.filter(p => p.status === 'queued').length,
    approaching: queue.filter(p => p.status === 'approaching').length,
    contacted: queue.filter(p => p.status === 'contacted').length,
    converted: queue.filter(p => p.status === 'converted').length,
    hot: queue.filter(p => p.signal.priority === 'hot').length,
    warm: queue.filter(p => p.signal.priority === 'warm').length,
  };
}

// ============================================================
// CONSTRUIR MENSAGEM DE ABORDAGEM CONTEXTUAL
// Personalizada com base no que o prospect postou/comentou
// ============================================================
function buildApproachMessage(params: {
  prospectName?: string;
  signal: SocialSignal;
  consultantName: string;
}): string {
  const { prospectName, signal, consultantName } = params;
  const firstName = prospectName?.split(' ')[0] ?? '';

  // Abordagens por tipo de intenção dominante
  if (signal.intentScore.businessScore >= signal.intentScore.productScore) {
    // Intenção de negócio
    return [
      `Olá${firstName ? `, ${firstName}` : ''}! Vi que você está buscando uma forma de gerar renda extra 🌱`,
      ``,
      `Sou ${consultantName} e trabalho com saúde e bem-estar — tenho ajudado pessoas a criar uma renda flexível enquanto cuidam da própria saúde.`,
      ``,
      `Posso te mostrar em 5 minutos como funciona? Sem compromisso! ☀️`,
    ].join('\n');
  }

  // Intenção de produto (emagrecimento/saúde/energia)
  const hasUrgency = signal.intentScore.urgencyScore >= 20;

  if (hasUrgency) {
    return [
      `Oi${firstName ? ` ${firstName}` : ''}! Vi que você está buscando resultados com saúde — e que quer isso logo! 💪`,
      ``,
      `Sou ${consultantName}, consultora de nutrição e bem-estar.`,
      `Já ajudei mais de 50 pessoas a atingirem o peso que queriam com um método simples e sem sofrimento.`,
      ``,
      `Posso te dar algumas dicas gratuitas? Me fala um pouco mais sobre o que você está buscando! 😊`,
    ].join('\n');
  }

  return [
    `Oi${firstName ? ` ${firstName}` : ''}! 🌿`,
    ``,
    `Vi que você está focada em saúde e bem-estar — que legal!`,
    `Sou ${consultantName} e compartilho dicas de nutrição e hábitos saudáveis que transformaram minha vida.`,
    ``,
    `Posso te mandar algumas dicas? 😊`,
  ].join('\n');
}

// ============================================================
// DISPARAR ABORDAGEM (via WhatsApp, se tiver telefone)
// ============================================================
export async function approachProspect(params: {
  consultantId: string;
  prospectId: string;
  prospectPhone: string;
  prospectName?: string;
}): Promise<boolean> {
  if (!isWithinAllowedHours()) {
    logger.warn('Abordagem bloqueada: fora do horário permitido');
    return false;
  }

  const queue = prospectQueues.get(params.consultantId);
  const entry = queue?.find(p => p.id === params.prospectId);
  if (!entry) return false;

  // Buscar nome do consultor
  const { data: consultant } = await db.client
    .from('consultants')
    .select('name')
    .eq('id', params.consultantId)
    .single();

  const consultantName = (consultant as { name: string } | null)?.name ?? 'Consultora Herbalife';

  const message = buildApproachMessage({
    prospectName: params.prospectName ?? entry.signal.profileName,
    signal: entry.signal,
    consultantName,
  });

  updateProspectStatus(params.consultantId, params.prospectId, 'approaching', {
    contactedPhone: params.prospectPhone,
  });

  enqueueSend(params.prospectPhone, async () => {
    await sendText(params.prospectPhone, message);
    updateProspectStatus(params.consultantId, params.prospectId, 'contacted');
    logger.info(`Abordagem enviada para ${params.prospectPhone.substring(0, 6)}... (prospect: @${entry.signal.profileId})`);
  });

  return true;
}

// ============================================================
// NOTIFICAR CONSULTOR SOBRE PROSPECTS NA FILA
// (Para HOT leads que ainda não têm telefone capturado)
// ============================================================
export async function notifyConsultantAboutProspects(
  consultantId: string
): Promise<void> {
  const hotProspects = getNextProspects(consultantId, 3).filter(
    p => p.signal.priority === 'hot'
  );

  if (hotProspects.length === 0) return;

  const { data: consultant } = await db.client
    .from('consultants')
    .select('phone, name')
    .eq('id', consultantId)
    .single();

  const cons = consultant as { phone: string; name: string } | null;
  if (!cons?.phone) return;

  const lines = [
    `🦅 *PELÍCANO — Prospects Quentes*`,
    ``,
    `${cons.name}, detectei ${hotProspects.length} prospect(s) com alto interesse:`,
    ``,
  ];

  for (const p of hotProspects) {
    lines.push(
      `🔥 @${p.signal.profileId} (${p.signal.platform})`,
      `   Score: ${p.signal.intentScore.total} | Keywords: ${p.signal.matchedKeywords.slice(0, 2).join(', ')}`,
      p.signal.postUrl ? `   Post: ${p.signal.postUrl}` : `   Texto: "${p.signal.messageText.substring(0, 60)}..."`,
      ``
    );
  }

  lines.push(`Acesse o painel para ver todos os prospects e iniciar a abordagem! 💼`);

  await sendText(cons.phone, lines.join('\n'));
  logger.info(`Consultor ${cons.name} notificado sobre ${hotProspects.length} prospects quentes`);
}
