/**
 * Webhook do Instagram / ManyChat
 *
 * Recebe eventos do Instagram Graph API e do ManyChat
 * (comentários, DMs, menções, stories replies).
 *
 * Configuração:
 * - Instagram Graph API: requer App Review para acesso a comentários
 * - ManyChat: usar como middleware (Instagram Connect)
 * - Webhook URL: POST /webhook/instagram
 */

import { createLogger } from '../lib/logger.js';
import { analyzeText, type SocialPlatform } from './social-listener.js';
import { enqueueProspect } from './prospect-queue.js';
import { db } from '../database/client.js';

const logger = createLogger('IG-WEBHOOK');

// ============================================================
// TIPOS DO INSTAGRAM GRAPH API
// ============================================================
type InstagramWebhookEntry = {
  id: string;         // Instagram User ID
  time: number;
  messaging?: InstagramMessaging[];
  changes?: InstagramChange[];
};

type InstagramMessaging = {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    attachments?: Array<{ type: string; payload: unknown }>;
  };
};

type InstagramChange = {
  field: string;
  value: {
    from?: { id: string; username?: string };
    id?: string;
    text?: string;
    media_id?: string;
    comment_id?: string;
    permalink_url?: string;
  };
};

export type InstagramWebhookPayload = {
  object: 'instagram';
  entry: InstagramWebhookEntry[];
};

// ============================================================
// TIPOS DO MANYCHAT
// ============================================================
export type ManyChatWebhookPayload = {
  type: 'new_subscriber' | 'first_interaction' | 'user_input' | 'opt_in';
  user_id: string;
  first_name?: string;
  last_name?: string;
  profile_pic_url?: string;
  last_input_text?: string;
  tags?: string[];
  custom_fields?: Record<string, string | number | boolean>;
};

// ============================================================
// MAPEAR INSTAGRAM PAGE ID → CONSULTANT ID
// Cache para evitar queries repetidas
// ============================================================
const pageConsultantCache = new Map<string, string>();

async function findConsultantByInstagramPage(pageId: string): Promise<string | null> {
  if (pageConsultantCache.has(pageId)) {
    return pageConsultantCache.get(pageId)!;
  }

  const { data } = await db.client
    .from('consultants')
    .select('id')
    .eq('instagram_page_id', pageId)
    .eq('active', true)
    .single();

  const consultantId = (data as { id: string } | null)?.id ?? null;
  if (consultantId) {
    pageConsultantCache.set(pageId, consultantId);
  }
  return consultantId;
}

// ============================================================
// PROCESSAR COMENTÁRIO DO INSTAGRAM
// ============================================================
async function handleInstagramComment(
  change: InstagramChange,
  pageId: string
): Promise<void> {
  if (change.field !== 'comments' && change.field !== 'feed') return;

  const val = change.value;
  const commentText = val.text ?? '';
  const userId = val.from?.id ?? '';
  const username = val.from?.username ?? userId;

  if (!commentText || !userId) return;

  const signal = analyzeText({
    platform: 'instagram' as SocialPlatform,
    profileId: username,
    messageText: commentText,
    postUrl: val.permalink_url,
  });

  if (!signal) return;

  const consultantId = await findConsultantByInstagramPage(pageId);
  if (!consultantId) {
    logger.warn(`Nenhum consultor mapeado para a página Instagram ${pageId}`);
    return;
  }

  enqueueProspect({ consultantId, signal });
}

// ============================================================
// PROCESSAR MENSAGEM DIRETA (DM) DO INSTAGRAM
// ============================================================
async function handleInstagramDM(
  messaging: InstagramMessaging,
  pageId: string
): Promise<void> {
  const text = messaging.message?.text ?? '';
  if (!text || messaging.sender.id === pageId) return; // ignorar mensagens enviadas pela página

  const signal = analyzeText({
    platform: 'instagram' as SocialPlatform,
    profileId: messaging.sender.id,
    messageText: text,
  });

  if (!signal) return;

  const consultantId = await findConsultantByInstagramPage(pageId);
  if (!consultantId) return;

  enqueueProspect({ consultantId, signal });
}

// ============================================================
// PROCESSADOR PRINCIPAL: INSTAGRAM GRAPH API
// ============================================================
export async function handleInstagramWebhook(
  payload: InstagramWebhookPayload
): Promise<void> {
  if (payload.object !== 'instagram') return;

  for (const entry of payload.entry) {
    const pageId = entry.id;

    // Processar comentários
    if (entry.changes) {
      for (const change of entry.changes) {
        await handleInstagramComment(change, pageId).catch(err =>
          logger.error('Erro ao processar comentário Instagram', err)
        );
      }
    }

    // Processar DMs
    if (entry.messaging) {
      for (const msg of entry.messaging) {
        await handleInstagramDM(msg, pageId).catch(err =>
          logger.error('Erro ao processar DM Instagram', err)
        );
      }
    }
  }
}

// ============================================================
// PROCESSADOR: MANYCHAT
// ============================================================
export async function handleManyChatWebhook(
  payload: ManyChatWebhookPayload,
  consultantId: string
): Promise<void> {
  logger.info(`ManyChat evento: ${payload.type} — user ${payload.user_id}`);

  const text = payload.last_input_text ?? '';
  const name = [payload.first_name, payload.last_name].filter(Boolean).join(' ');

  // Novos assinantes ou primeiras interações sempre entram na fila
  const isNewUser = payload.type === 'new_subscriber' || payload.type === 'first_interaction';

  let signal = analyzeText({
    platform: 'manychat' as SocialPlatform,
    profileId: payload.user_id,
    profileName: name || undefined,
    messageText: text || `Novo contato via ManyChat (${payload.type})`,
  });

  // Se é novo usuário sem texto relevante, criar sinal mínimo de warm
  if (!signal && isNewUser) {
    signal = {
      platform: 'manychat' as SocialPlatform,
      profileId: payload.user_id,
      profileName: name || undefined,
      messageText: text || `Novo assinante via ManyChat`,
      detectedAt: new Date(),
      intentScore: { productScore: 25, businessScore: 10, urgencyScore: 5, total: 40 },
      matchedKeywords: ['manychat_subscriber'],
      priority: 'warm',
    };
  }

  if (!signal) return;

  enqueueProspect({ consultantId, signal });
}

// ============================================================
// VERIFICAÇÃO DO WEBHOOK (Meta API)
// GET /webhook/instagram?hub.mode=subscribe&hub.challenge=...
// ============================================================
export function verifyInstagramWebhook(params: {
  mode?: string;
  token?: string;
  challenge?: string;
  verifyToken: string;
}): string | null {
  if (params.mode === 'subscribe' && params.token === params.verifyToken) {
    logger.info('Webhook Instagram verificado com sucesso');
    return params.challenge ?? null;
  }
  logger.warn('Falha na verificação do webhook Instagram');
  return null;
}
