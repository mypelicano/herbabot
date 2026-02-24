/**
 * Módulo de Segurança Anti-Ban
 * Controla rate limiting, delays humanizados e detecção de bloqueio
 */

import { config } from '../config/index.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('SAFETY');

// ============================================================
// DELAY ALEATÓRIO HUMANIZADO
// ============================================================
export function randomDelay(
  minMs?: number,
  maxMs?: number
): Promise<void> {
  const min = minMs ?? config.safety.minDelayMs;
  const max = maxMs ?? config.safety.maxDelayMs;
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;

  logger.debug(`Delay humanizado: ${delay}ms`);
  return new Promise(resolve => setTimeout(resolve, delay));
}

// ============================================================
// CONTADOR DE MENSAGENS POR NÚMERO (janela de 1 hora)
// ============================================================
type MessageRecord = { count: number; windowStart: number };
const messageCounters = new Map<string, MessageRecord>();

export function checkRateLimit(phone: string): boolean {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1 hora
  const maxPerHour = config.safety.maxMessagesPerHour;

  const record = messageCounters.get(phone);

  if (!record || (now - record.windowStart) > windowMs) {
    // Nova janela
    messageCounters.set(phone, { count: 1, windowStart: now });
    return true; // permitido
  }

  if (record.count >= maxPerHour) {
    logger.warn(`Rate limit atingido para ${phone.substring(0, 6)}... (${record.count}/${maxPerHour} na última hora)`);
    return false; // bloqueado
  }

  record.count++;
  return true;
}

export function getRateLimitInfo(phone: string): { count: number; remaining: number } {
  const record = messageCounters.get(phone);
  const count = record?.count ?? 0;
  return { count, remaining: config.safety.maxMessagesPerHour - count };
}

// ============================================================
// FILA GLOBAL DE ENVIO (evita explosão de requisições paralelas)
// ============================================================
type QueueItem = { execute: () => Promise<void>; phone: string };
const sendQueue: QueueItem[] = [];
let isProcessing = false;

export function enqueueSend(phone: string, fn: () => Promise<void>): void {
  sendQueue.push({ execute: fn, phone });
  if (!isProcessing) processQueue();
}

async function processQueue(): Promise<void> {
  if (sendQueue.length === 0) {
    isProcessing = false;
    return;
  }

  isProcessing = true;
  const item = sendQueue.shift()!;

  if (!checkRateLimit(item.phone)) {
    logger.warn(`Mensagem descartada por rate limit: ${item.phone.substring(0, 6)}...`);
    setImmediate(() => processQueue());
    return;
  }

  try {
    await item.execute();
  } catch (error) {
    logger.error('Erro ao processar item da fila', error);
  }

  // Delay entre itens da fila
  await randomDelay(1000, 3000);
  setImmediate(() => processQueue());
}

// ============================================================
// DETECTOR DE HORÁRIO PERMITIDO (8h–21h no fuso do consultor)
// ============================================================
export function isWithinAllowedHours(timezoneOffset: number = config.safety.timezoneOffset): boolean {
  const utcHour = new Date().getUTCHours();
  const localHour = (utcHour + timezoneOffset + 24) % 24;
  return localHour >= 8 && localHour <= 21;
}

// ============================================================
// VARIAÇÃO DE TEXTO (evita mensagens idênticas repetidas)
// Substitui {var} por um item aleatório do array fornecido
// ============================================================
export function varyText(
  template: string,
  variations: Record<string, string[]>
): string {
  let result = template;
  for (const [key, options] of Object.entries(variations)) {
    const chosen = options[Math.floor(Math.random() * options.length)];
    result = result.replaceAll(`{${key}}`, chosen);
  }
  return result;
}

// Exemplos de variações comuns em PT-BR
export const TEXT_VARIATIONS = {
  greeting: ['Oi', 'Olá', 'E aí', 'Boa tarde', 'Boa noite', 'Oi, tudo bem'],
  affirmation: ['Que ótimo', 'Perfeito', 'Show', 'Legal', 'Que bom', 'Ótimo'],
  empathy: ['Entendo', 'Faz sentido', 'Imagino', 'Compreendo'],
  closing: ['Qualquer dúvida, é só chamar', 'Estou aqui se precisar', 'Pode contar comigo'],
  emoji_energy: ['⚡', '🔥', '💪', '✨', '🌟'],
  emoji_health: ['🌿', '🥗', '💚', '🌱', '🍃'],
};

// ============================================================
// LIMPAR CONTADORES (GC periódico)
// ============================================================
setInterval(() => {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  let cleaned = 0;

  for (const [phone, record] of messageCounters.entries()) {
    if ((now - record.windowStart) > windowMs * 2) {
      messageCounters.delete(phone);
      cleaned++;
    }
  }

  if (cleaned > 0) logger.debug(`Rate limiter: ${cleaned} contadores limpos`);
}, 30 * 60 * 1000);
