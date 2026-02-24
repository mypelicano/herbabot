import type { ConversationMessage, LeadContextData } from '../database/client.js';
import { createLogger } from '../lib/logger.js';
import { redisSet, redisGet, REDIS_KEYS } from '../lib/redis.js';

const logger = createLogger('MEMORY');

// ============================================================
// MEMÓRIA DE CONTEXTO DO LEAD
// L1 cache: Map em memória (acesso ~0ms)
// L2 cache: Redis/Upstash (sobrevive reinicializações do server)
// L3 persistência: Supabase (fonte de verdade)
// ============================================================

export type LeadMemory = {
  leadId: string;
  consultantId: string;
  conversationId: string;
  spinStage: string;
  messages: ConversationMessage[];
  context: LeadContextData;
  signals: string[];
  handoffScore: number;
  messageCount: number;
  lastUpdated: Date;
};

// L1: Cache em memória (Map por conversationId)
const memoryCache = new Map<string, LeadMemory>();

// ============================================================
// HELPERS INTERNOS — PERSISTÊNCIA NO REDIS
// ============================================================

// Salva memória no Redis em background (fire-and-forget)
function _persistToRedis(memory: LeadMemory): void {
  redisSet(REDIS_KEYS.conversation(memory.conversationId), memory).catch(() => {
    // Erros já logados dentro do redisSet
  });
}

// Deserializa memória do JSON armazenado no Redis
function _deserializeMemory(raw: unknown): LeadMemory | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (!m['conversationId'] || !m['leadId']) return null;

  return {
    leadId: m['leadId'] as string,
    consultantId: m['consultantId'] as string,
    conversationId: m['conversationId'] as string,
    spinStage: (m['spinStage'] as string) ?? 'ice_break',
    messages: (m['messages'] as ConversationMessage[]) ?? [],
    context: (m['context'] as LeadContextData) ?? {},
    signals: (m['signals'] as string[]) ?? [],
    handoffScore: (m['handoffScore'] as number) ?? 0,
    messageCount: (m['messageCount'] as number) ?? 0,
    lastUpdated: new Date((m['lastUpdated'] as string) ?? Date.now()),
  };
}

// ============================================================
// CRIAR MEMÓRIA INICIAL
// ============================================================
export function createMemory(params: {
  leadId: string;
  consultantId: string;
  conversationId: string;
  initialContext?: Partial<LeadContextData>;
}): LeadMemory {
  const memory: LeadMemory = {
    leadId: params.leadId,
    consultantId: params.consultantId,
    conversationId: params.conversationId,
    spinStage: 'ice_break',
    messages: [],
    context: params.initialContext ?? {},
    signals: [],
    handoffScore: 0,
    messageCount: 0,
    lastUpdated: new Date(),
  };

  memoryCache.set(params.conversationId, memory);
  _persistToRedis(memory);
  logger.debug(`Memória criada para conversa ${params.conversationId}`);
  return memory;
}

// ============================================================
// RECUPERAR MEMÓRIA (L1 — síncrono, apenas cache local)
// ============================================================
export function getMemory(conversationId: string): LeadMemory | null {
  return memoryCache.get(conversationId) ?? null;
}

// ============================================================
// RECUPERAR MEMÓRIA COM FALLBACK REDIS (L2 — assíncrono)
// Chamado quando o cache local está vazio (ex: após restart)
// ============================================================
export async function getMemoryAsync(conversationId: string): Promise<LeadMemory | null> {
  // L1: cache local
  const cached = memoryCache.get(conversationId);
  if (cached) return cached;

  // L2: Redis
  const raw = await redisGet<unknown>(REDIS_KEYS.conversation(conversationId));
  const restored = _deserializeMemory(raw);
  if (restored) {
    memoryCache.set(conversationId, restored);
    logger.debug(`Memória restaurada do Redis para ${conversationId}`);
    return restored;
  }

  return null;
}

// ============================================================
// ADICIONAR MENSAGEM
// ============================================================
export function addMessage(
  conversationId: string,
  role: 'assistant' | 'user',
  content: string
): void {
  const memory = memoryCache.get(conversationId);
  if (!memory) {
    logger.warn(`Memória não encontrada para ${conversationId}`);
    return;
  }

  memory.messages.push({
    role,
    content,
    timestamp: new Date().toISOString(),
  });
  memory.messageCount++;
  memory.lastUpdated = new Date();
  _persistToRedis(memory);
}

// ============================================================
// ATUALIZAR CONTEXTO (dados coletados sobre o lead)
// ============================================================
export function updateContext(
  conversationId: string,
  updates: Partial<LeadContextData>
): void {
  const memory = memoryCache.get(conversationId);
  if (!memory) return;

  memory.context = { ...memory.context, ...updates };
  memory.lastUpdated = new Date();
  _persistToRedis(memory);
  logger.debug(`Contexto atualizado para ${conversationId}`, updates);
}

// ============================================================
// AVANÇAR ETAPA DO SPIN
// ============================================================
const PRODUCT_FLOW = [
  'ice_break',
  'situation',
  'problem',
  'implication',
  'commitment',
  'transition',
  'closed',
] as const;

const BUSINESS_FLOW = [
  'biz_ice_break',
  'biz_qualification',
  'biz_implication',
  'biz_commitment',
  'transition',
  'closed',
] as const;

export function advanceStage(conversationId: string): string {
  const memory = memoryCache.get(conversationId);
  if (!memory) return 'ice_break';

  const isBusiness = memory.context.profile_type === 'business';
  const flow = isBusiness ? BUSINESS_FLOW : PRODUCT_FLOW;

  const currentIndex = (flow as readonly string[]).indexOf(memory.spinStage);
  const nextIndex = Math.min(currentIndex + 1, flow.length - 1);
  const nextStage = flow[nextIndex];

  memory.spinStage = nextStage;
  memory.lastUpdated = new Date();
  _persistToRedis(memory);
  logger.info(`Etapa avançada: ${flow[currentIndex]} → ${nextStage}`);
  return nextStage;
}

// ============================================================
// ADICIONAR SINAL DE COMPORTAMENTO
// ============================================================
export function addSignal(conversationId: string, signal: string): void {
  const memory = memoryCache.get(conversationId);
  if (!memory) return;

  if (!memory.signals.includes(signal)) {
    memory.signals.push(signal);
    _persistToRedis(memory);
  }
}

// ============================================================
// ATUALIZAR SCORE DE HANDOFF
// ============================================================
export function updateHandoffScore(conversationId: string, score: number): void {
  const memory = memoryCache.get(conversationId);
  if (!memory) return;

  memory.handoffScore = score;
  _persistToRedis(memory);
}

// ============================================================
// SERIALIZAR PARA SALVAR NO BANCO
// ============================================================
export function serializeMemory(conversationId: string): {
  spinStage: string;
  messages: ConversationMessage[];
  contextData: LeadContextData;
} | null {
  const memory = memoryCache.get(conversationId);
  if (!memory) return null;

  return {
    spinStage: memory.spinStage,
    messages: memory.messages,
    contextData: memory.context,
  };
}

// ============================================================
// RESTAURAR MEMÓRIA DO BANCO (Supabase → L1 cache)
// ============================================================
export function restoreMemory(params: {
  leadId: string;
  consultantId: string;
  conversationId: string;
  spinStage: string;
  messages: ConversationMessage[];
  contextData: LeadContextData;
}): LeadMemory {
  const memory: LeadMemory = {
    leadId: params.leadId,
    consultantId: params.consultantId,
    conversationId: params.conversationId,
    spinStage: params.spinStage,
    messages: params.messages,
    context: params.contextData,
    signals: [],
    handoffScore: 0,
    messageCount: params.messages.length,
    lastUpdated: new Date(),
  };

  memoryCache.set(params.conversationId, memory);
  _persistToRedis(memory);
  logger.debug(`Memória restaurada para ${params.conversationId} (${params.messages.length} mensagens)`);
  return memory;
}

// ============================================================
// LIMPAR MEMÓRIA ANTIGA (garbage collection)
// ============================================================
export function cleanOldMemories(maxAgeHours: number = 24): void {
  const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
  let cleaned = 0;

  for (const [id, memory] of memoryCache.entries()) {
    if (memory.lastUpdated < cutoff) {
      memoryCache.delete(id);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.info(`Memórias limpas: ${cleaned} conversas antigas removidas`);
  }
}

// Limpeza automática a cada 6 horas
setInterval(() => cleanOldMemories(24), 6 * 60 * 60 * 1000);
