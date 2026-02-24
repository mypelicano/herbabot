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

// Cache em memória para leitura rápida (sincronizado com Supabase)
const prospectQueues = new Map<string, ProspectEntry[]>();

// ============================================================
// TIPOS DO BANCO
// ============================================================
type QueueRow = {
  id: string;
  consultant_id: string;
  profile_id: string;
  platform: string;
  profile_name: string | null;
  post_url: string | null;
  message_text: string;
  product_score: number;
  business_score: number;
  urgency_score: number;
  matched_keywords: string[];
  priority: 'hot' | 'warm' | 'cold';
  status: ProspectEntry['status'];
  approached_at: string | null;
  contacted_phone: string | null;
  notes: string | null;
  created_at: string;
};

function rowToEntry(row: QueueRow): ProspectEntry {
  return {
    id: row.id,
    consultantId: row.consultant_id,
    signal: {
      profileId: row.profile_id,
      platform: row.platform as SocialSignal['platform'],
      profileName: row.profile_name ?? undefined,
      postUrl: row.post_url ?? undefined,
      messageText: row.message_text,
      intentScore: {
        productScore: row.product_score,
        businessScore: row.business_score,
        urgencyScore: row.urgency_score,
        total: Math.round((row.product_score + row.business_score + row.urgency_score) / 3),
      },
      matchedKeywords: row.matched_keywords,
      priority: row.priority,
      detectedAt: new Date(row.created_at),
    },
    status: row.status,
    approachedAt: row.approached_at ? new Date(row.approached_at) : undefined,
    contactedPhone: row.contacted_phone ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: new Date(row.created_at),
  };
}

// ============================================================
// ADICIONAR PROSPECT À FILA (com persistência no Supabase)
// ============================================================
export async function enqueueProspect(params: {
  consultantId: string;
  signal: SocialSignal;
}): Promise<ProspectEntry> {
  const { consultantId, signal } = params;

  // Verificar duplicata no banco (últimas 24h)
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: existing } = await db.client
    .from('prospect_queue')
    .select('id')
    .eq('consultant_id', consultantId)
    .eq('profile_id', signal.profileId)
    .eq('platform', signal.platform)
    .gte('created_at', since)
    .limit(1);

  if (existing?.length) {
    logger.debug(`Prospect ${signal.profileId} já está na fila — ignorando duplicata`);
    const cached = prospectQueues.get(consultantId);
    return cached?.find(p => p.signal.profileId === signal.profileId) ?? {
      id: (existing[0] as { id: string }).id,
      consultantId,
      signal,
      status: 'queued',
      createdAt: new Date(),
    };
  }

  const entry: ProspectEntry = {
    id: `pq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    consultantId,
    signal,
    status: 'queued',
    createdAt: new Date(),
  };

  // Persistir no Supabase
  await db.client.from('prospect_queue').insert({
    id: entry.id,
    consultant_id: consultantId,
    profile_id: signal.profileId,
    platform: signal.platform,
    profile_name: signal.profileName ?? null,
    post_url: signal.postUrl ?? null,
    message_text: signal.messageText,
    product_score: signal.intentScore.productScore,
    business_score: signal.intentScore.businessScore,
    urgency_score: signal.intentScore.urgencyScore,
    matched_keywords: signal.matchedKeywords,
    priority: signal.priority,
    status: 'queued',
  });

  // Atualizar cache por prioridade
  if (!prospectQueues.has(consultantId)) prospectQueues.set(consultantId, []);
  const queue = prospectQueues.get(consultantId)!;
  const priorityOrder = { hot: 0, warm: 1, cold: 2 };
  const insertIdx = queue.findIndex(
    p => priorityOrder[p.signal.priority] > priorityOrder[signal.priority]
  );
  if (insertIdx === -1) queue.push(entry);
  else queue.splice(insertIdx, 0, entry);

  logger.info(
    `Prospect enfileirado [${signal.priority.toUpperCase()}]: @${signal.profileId} (${signal.platform}) — consultor ${consultantId.substring(0, 8)}...`
  );

  return entry;
}

// ============================================================
// OBTER PRÓXIMOS DA FILA (com fallback ao Supabase após restart)
// ============================================================
export async function getNextProspects(consultantId: string, limit = 5): Promise<ProspectEntry[]> {
  const cached = prospectQueues.get(consultantId);
  if (cached?.length) {
    return cached.filter(p => p.status === 'queued').slice(0, limit);
  }

  // Fallback: buscar do Supabase (recupera estado após restart)
  const { data } = await db.client
    .from('prospect_queue')
    .select('*')
    .eq('consultant_id', consultantId)
    .eq('status', 'queued')
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(limit);

  if (!data?.length) return [];
  const entries = (data as QueueRow[]).map(rowToEntry);
  prospectQueues.set(consultantId, entries);
  return entries;
}

// ============================================================
// ATUALIZAR STATUS DO PROSPECT (memória + Supabase)
// ============================================================
export async function updateProspectStatus(
  consultantId: string,
  prospectId: string,
  status: ProspectEntry['status'],
  extras?: { contactedPhone?: string; notes?: string }
): Promise<void> {
  // Atualizar cache
  const entry = prospectQueues.get(consultantId)?.find(p => p.id === prospectId);
  if (entry) {
    entry.status = status;
    if (extras?.contactedPhone) entry.contactedPhone = extras.contactedPhone;
    if (extras?.notes) entry.notes = extras.notes;
    if (status === 'approaching') entry.approachedAt = new Date();
  }

  // Persistir no Supabase
  await db.client
    .from('prospect_queue')
    .update({
      status,
      contacted_phone: extras?.contactedPhone ?? null,
      notes: extras?.notes ?? null,
      approached_at: status === 'approaching' ? new Date().toISOString() : null,
    })
    .eq('id', prospectId);
}

// ============================================================
// ESTATÍSTICAS DA FILA (do Supabase para dados precisos)
// ============================================================
export async function getQueueStats(consultantId: string) {
  const { data } = await db.client
    .from('prospect_queue')
    .select('status, priority')
    .eq('consultant_id', consultantId)
    .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

  const rows = (data ?? []) as Array<{ status: string; priority: string }>;
  return {
    total: rows.length,
    queued: rows.filter(r => r.status === 'queued').length,
    approaching: rows.filter(r => r.status === 'approaching').length,
    contacted: rows.filter(r => r.status === 'contacted').length,
    converted: rows.filter(r => r.status === 'converted').length,
    hot: rows.filter(r => r.priority === 'hot').length,
    warm: rows.filter(r => r.priority === 'warm').length,
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

  await updateProspectStatus(params.consultantId, params.prospectId, 'approaching', {
    contactedPhone: params.prospectPhone,
  });

  enqueueSend(params.prospectPhone, async () => {
    await sendText(params.prospectPhone, message);
    await updateProspectStatus(params.consultantId, params.prospectId, 'contacted');
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
  const allProspects = await getNextProspects(consultantId, 10);
  const hotProspects = allProspects.filter(p => p.signal.priority === 'hot').slice(0, 3);

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
