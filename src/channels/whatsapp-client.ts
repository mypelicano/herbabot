/**
 * Cliente da Evolution API (wrapper oficial do Baileys)
 * Documentação: https://doc.evolution-api.com
 *
 * A Evolution API é auto-hospedada e expõe uma REST API
 * para envio/recebimento de mensagens WhatsApp.
 */

import { createLogger } from '../lib/logger.js';
import { config } from '../config/index.js';
import { randomDelay } from '../safety/rate-limiter.js';

const logger = createLogger('WHATSAPP');

// ============================================================
// CONFIGURAÇÃO DA EVOLUTION API
// ============================================================
const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL ?? 'http://localhost:8080';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY ?? '';
const INSTANCE_NAME    = process.env.EVOLUTION_INSTANCE ?? 'pelicano';

type FetchOptions = {
  method: 'GET' | 'POST' | 'DELETE' | 'PUT';
  body?: unknown;
};

// ============================================================
// HTTP HELPER
// ============================================================
async function apiRequest<T>(path: string, options: FetchOptions): Promise<T> {
  const url = `${EVOLUTION_API_URL}${path}`;
  const res = await fetch(url, {
    method: options.method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': EVOLUTION_API_KEY,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(15000), // 15s timeout — nunca travar
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Evolution API [${res.status}]: ${errorText}`);
  }

  return res.json() as Promise<T>;
}

// ============================================================
// TIPOS DE RESPOSTA DA EVOLUTION API
// ============================================================
export type EvolutionMessage = {
  key: {
    remoteJid: string;   // número@s.whatsapp.net
    fromMe: boolean;
    id: string;
  };
  message: {
    conversation?: string;
    extendedTextMessage?: { text: string };
    audioMessage?: { url: string; mimetype: string };
    imageMessage?: { url: string; caption?: string };
  };
  messageType: string;
  messageTimestamp: number;
  pushName?: string;     // nome salvo no WhatsApp
};

export type EvolutionWebhookPayload = {
  event: string;
  instance: string;
  data: EvolutionMessage | Record<string, unknown>;
};

export type SendTextResult = {
  key: { id: string; remoteJid: string };
  status: string;
};

// ============================================================
// EXTRAIR TEXTO DE UMA MENSAGEM
// ============================================================
export function extractMessageText(msg: EvolutionMessage): string | null {
  return (
    msg.message.conversation ??
    msg.message.extendedTextMessage?.text ??
    null
  );
}

// ============================================================
// EXTRAIR NÚMERO DO JID
// ============================================================
export function jidToPhone(jid: string): string {
  // "5511999990000@s.whatsapp.net" → "5511999990000"
  return jid.replace(/@s\.whatsapp\.net$/, '').replace(/@g\.us$/, '');
}

export function phoneToJid(phone: string): string {
  // Normaliza e converte para JID
  const normalized = phone.replace(/\D/g, '');
  return `${normalized}@s.whatsapp.net`;
}

// ============================================================
// ENVIAR MENSAGEM DE TEXTO (com delay humanizado)
// ============================================================
export async function sendText(
  phone: string,
  text: string,
  options: { skipDelay?: boolean } = {}
): Promise<SendTextResult> {
  const jid = phoneToJid(phone);

  logger.info(`Enviando texto para ${phone.substring(0, 6)}...`);

  // Simular digitação humana
  if (!options.skipDelay) {
    await randomDelay();
  }

  const result = await apiRequest<SendTextResult>(
    `/message/sendText/${INSTANCE_NAME}`,
    {
      method: 'POST',
      body: {
        number: jid,
        textMessage: { text },
        delay: Math.floor(config.safety.minDelayMs / 1000) * 1000,
      },
    }
  );

  logger.info(`Mensagem enviada: ${result.key.id}`);
  return result;
}

// ============================================================
// ENVIAR ÁUDIO (URL, base64 string ou Buffer)
// ============================================================
export async function sendAudio(
  phone: string,
  audio: string | Buffer
): Promise<void> {
  const jid = phoneToJid(phone);

  await randomDelay();

  // Converter Buffer para base64 data URI se necessário
  const audioPayload = Buffer.isBuffer(audio)
    ? `data:audio/mpeg;base64,${audio.toString('base64')}`
    : audio;

  await apiRequest(`/message/sendWhatsAppAudio/${INSTANCE_NAME}`, {
    method: 'POST',
    body: {
      number: jid,
      audio: audioPayload,
      encoding: true,
    },
  });

  logger.info(`Áudio enviado para ${phone.substring(0, 6)}...`);
}

// ============================================================
// MARCAR COMO LIDA (evita "deixar no visto" muito rápido)
// ============================================================
export async function markAsRead(jid: string, messageId: string): Promise<void> {
  await apiRequest(`/message/markMessageAsRead/${INSTANCE_NAME}`, {
    method: 'POST',
    body: {
      readMessages: [{ remoteJid: jid, id: messageId, fromMe: false }],
    },
  });
}

// ============================================================
// SIMULAR "DIGITANDO..." (presença)
// ============================================================
export async function sendTyping(phone: string, durationMs: number = 3000): Promise<void> {
  const jid = phoneToJid(phone);

  await apiRequest(`/chat/sendPresence/${INSTANCE_NAME}`, {
    method: 'POST',
    body: {
      number: jid,
      options: { presence: 'composing', delay: durationMs },
    },
  });
}

// ============================================================
// OBTER STATUS DA INSTÂNCIA
// ============================================================
export type InstanceStatus = {
  instance: { instanceName: string; status: string };
  qrcode?: { base64: string };
};

export async function getInstanceStatus(): Promise<InstanceStatus> {
  return apiRequest<InstanceStatus>(
    `/instance/connectionState/${INSTANCE_NAME}`,
    { method: 'GET' }
  );
}

// ============================================================
// CRIAR INSTÂNCIA (setup inicial)
// ============================================================
export async function createInstance(): Promise<{ qrcode: { base64: string } }> {
  return apiRequest(`/instance/create`, {
    method: 'POST',
    body: {
      instanceName: INSTANCE_NAME,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
      webhook: {
        enabled: true,
        url: `${process.env.WEBHOOK_BASE_URL}/webhook/whatsapp`,
        events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
        webhookByEvents: false,
        webhookBase64: false,
      },
    },
  });
}

// ============================================================
// CONFIGURAR WEBHOOK NA INSTÂNCIA EXISTENTE
// ============================================================
export async function configureWebhook(baseUrl: string): Promise<void> {
  await apiRequest(`/webhook/set/${INSTANCE_NAME}`, {
    method: 'POST',
    body: {
      enabled: true,
      url: `${baseUrl}/webhook/whatsapp`,
      events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'MESSAGES_SET'],
      webhookByEvents: false,
      webhookBase64: false,
    },
  });
  logger.info(`Webhook configurado: ${baseUrl}/webhook/whatsapp`);
}
