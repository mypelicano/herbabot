/**
 * Cliente Redis (Upstash ou qualquer Redis compatível)
 *
 * Usado para persistir memória de conversas entre reinicializações
 * do servidor (ex: Render free tier hiberna após 15 min).
 *
 * Se REDIS_URL não estiver configurada, opera em modo "no-op"
 * (sem Redis — apenas memória local, sem persistência).
 */

import Redis from 'ioredis';
import { createLogger } from './logger.js';

const logger = createLogger('REDIS');

// TTL padrão: 48h (conversas activas raramente passam disso)
const DEFAULT_TTL_SEC = 48 * 60 * 60;

// Singleton do cliente Redis
let _client: Redis | null = null;
let _enabled = false;

function getClient(): Redis | null {
  if (_client) return _client;

  const url = process.env.REDIS_URL;
  if (!url) {
    // Primeira vez sem URL — logar apenas uma vez
    if (!_enabled) {
      logger.info('REDIS_URL não configurada — operando sem Redis (apenas memória local)');
      _enabled = true; // flag para não logar de novo
    }
    return null;
  }

  try {
    _client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 500, 2000)),
    });

    _client.on('connect', () => logger.info('Redis conectado ✅'));
    _client.on('error', (err: Error) => logger.warn(`Redis erro: ${err.message}`));

    _enabled = true;
    return _client;
  } catch (err) {
    logger.warn('Falha ao inicializar Redis client', err);
    return null;
  }
}

// ============================================================
// OPERAÇÕES PÚBLICAS
// ============================================================

export async function redisSet(key: string, value: unknown, ttlSec = DEFAULT_TTL_SEC): Promise<void> {
  const client = getClient();
  if (!client) return;

  try {
    await client.set(key, JSON.stringify(value), 'EX', ttlSec);
  } catch (err) {
    logger.warn(`redisSet falhou para key=${key}`, err);
  }
}

export async function redisGet<T>(key: string): Promise<T | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const raw = await client.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    logger.warn(`redisGet falhou para key=${key}`, err);
    return null;
  }
}

export async function redisDel(key: string): Promise<void> {
  const client = getClient();
  if (!client) return;

  try {
    await client.del(key);
  } catch (err) {
    logger.warn(`redisDel falhou para key=${key}`, err);
  }
}

// Prefixos de chaves para evitar colisões
export const REDIS_KEYS = {
  conversation: (id: string) => `pelicano:conv:${id}`,
  checkinSession: (phone: string) => `pelicano:checkin:${phone}`,
} as const;
