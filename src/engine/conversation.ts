import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/index.js';
import { createLogger } from '../lib/logger.js';
import { db, type LeadContextData } from '../database/client.js';
import {
  PELICANO_SYSTEM_PROMPT,
  SPIN_STAGES,
  BUSINESS_SPIN_STAGES,
  SPECIAL_RESPONSES,
} from './spin-prompts.js';
import {
  createMemory,
  getMemoryAsync,
  addMessage,
  updateContext,
  advanceStage,
  addSignal,
  updateHandoffScore,
  serializeMemory,
  restoreMemory,
  type LeadMemory,
} from './context-memory.js';
import {
  detectConversationSignals,
  calculateHandoffScore,
  shouldHandoff,
} from './intent-scorer.js';

const logger = createLogger('CONVERSATION');
const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

// ============================================================
// TIPO DE RESPOSTA DO MOTOR
// ============================================================
export type ConversationResult = {
  reply: string;
  spinStage: string;
  handoffTriggered: boolean;
  handoffScore?: number;
  contextUpdated: Partial<LeadContextData>;
  nextAction: 'continue' | 'handoff' | 'close' | 'request_whatsapp';
};

// ============================================================
// OBTER OU CRIAR CONVERSA
// ============================================================
async function getOrCreateConversation(params: {
  leadId: string;
  consultantId: string;
  channel: string;
  initialContext?: Partial<LeadContextData>;
}): Promise<LeadMemory> {
  // Tentar buscar conversa ativa no banco
  const existingConversation = await db.conversations.findActive(params.leadId);

  if (existingConversation) {
    // Verificar L1 (memória local) e L2 (Redis) antes de reconstruir do Supabase
    const cached = await getMemoryAsync(existingConversation.id);
    if (cached) return cached;

    // Fallback L3: restaurar dos dados do Supabase já carregados
    return restoreMemory({
      leadId: params.leadId,
      consultantId: params.consultantId,
      conversationId: existingConversation.id,
      spinStage: existingConversation.spin_stage,
      messages: existingConversation.messages,
      contextData: existingConversation.context_data,
    });
  }

  // Criar nova conversa
  const newConversation = await db.conversations.create({
    lead_id: params.leadId,
    consultant_id: params.consultantId,
    channel: params.channel,
    spin_stage: 'ice_break',
    messages: [],
    context_data: params.initialContext ?? {},
    handoff_triggered: false,
    status: 'active',
    converted_at: null,
  });

  return createMemory({
    leadId: params.leadId,
    consultantId: params.consultantId,
    conversationId: newConversation.id,
    initialContext: params.initialContext,
  });
}

// ============================================================
// CONSTRUIR PROMPT PARA A ETAPA ATUAL
// ============================================================
function buildStagePrompt(memory: LeadMemory): string {
  const { spinStage, context } = memory;
  const isBusiness = context.profile_type === 'business';

  // Mapear etapa para prompt correspondente
  switch (spinStage) {
    case 'ice_break':
      return SPIN_STAGES.ICE_BREAK.prompt(context);
    case 'situation':
      return SPIN_STAGES.SITUATION.prompt(context);
    case 'problem':
      return SPIN_STAGES.PROBLEM.prompt(context);
    case 'implication':
      return SPIN_STAGES.IMPLICATION.prompt(context);
    case 'commitment':
      return SPIN_STAGES.COMMITMENT.prompt(context);
    case 'transition':
      return SPIN_STAGES.TRANSITION.prompt(context);
    case 'biz_ice_break':
      return BUSINESS_SPIN_STAGES.ICE_BREAK.prompt(context);
    case 'biz_qualification':
      return BUSINESS_SPIN_STAGES.QUALIFICATION.prompt(context);
    case 'biz_implication':
      return isBusiness
        ? BUSINESS_SPIN_STAGES.IMPLICATION.prompt(context)
        : SPIN_STAGES.IMPLICATION.prompt(context);
    case 'biz_commitment':
      return BUSINESS_SPIN_STAGES.COMMITMENT.prompt(context);
    default:
      return SPIN_STAGES.ICE_BREAK.prompt(context);
  }
}

// ============================================================
// DETECTAR ATUALIZAÇÃO DE CONTEXTO NA RESPOSTA DO LEAD
// ============================================================
function extractContextFromMessage(message: string, currentContext: LeadContextData): Partial<LeadContextData> {
  const updates: Partial<LeadContextData> = {};
  const text = message.toLowerCase();

  // Detectar nome
  const nameMatch = message.match(/(?:me chamo|meu nome é|sou (?:a |o )?)\s*([A-ZÀ-Ú][a-zà-ú]+)/i);
  if (nameMatch && !currentContext.name) {
    updates.name = nameMatch[1];
  }

  // Detectar dores mencionadas
  const pains: string[] = [];
  if (text.includes('energia')) pains.push('falta de energia');
  if (text.includes('cansad')) pains.push('cansaço crônico');
  if (text.includes('emagrec') || text.includes('peso')) pains.push('dificuldade para emagrecer');
  if (text.includes('barriga')) pains.push('barriga inchada');
  if (text.includes('disposiç')) pains.push('falta de disposição');
  if (text.includes('sono')) pains.push('problemas de sono');
  if (text.includes('ansied')) pains.push('ansiedade alimentar');
  if (pains.length > 0) {
    updates.pain_points = [...(currentContext.pain_points ?? []), ...pains];
  }

  // Detectar perfil de negócio
  if (text.includes('renda') || text.includes('dinheiro') || text.includes('negócio') || text.includes('empreend')) {
    if (!currentContext.profile_type) {
      updates.profile_type = 'business';
    }
  }

  return updates;
}

// ============================================================
// MOTOR PRINCIPAL: PROCESSAR MENSAGEM DO LEAD
// ============================================================
export async function processMessage(params: {
  leadId: string;
  consultantId: string;
  channel: string;
  userMessage: string;
  initialContext?: Partial<LeadContextData>;
}): Promise<ConversationResult> {
  logger.info(`Processando mensagem do lead ${params.leadId}`);

  // Obter/criar memória da conversa
  const memory = await getOrCreateConversation({
    leadId: params.leadId,
    consultantId: params.consultantId,
    channel: params.channel,
    initialContext: params.initialContext,
  });

  // Adicionar mensagem do usuário à memória
  addMessage(memory.conversationId, 'user', params.userMessage);

  // Detectar sinais de comportamento na mensagem
  const signals = detectConversationSignals(params.userMessage);
  signals.forEach(signal => addSignal(memory.conversationId, signal));

  // Calcular score de handoff
  const newHandoffScore = calculateHandoffScore(memory.handoffScore, signals);
  updateHandoffScore(memory.conversationId, newHandoffScore);

  // Verificar se deve fazer handoff
  if (shouldHandoff(newHandoffScore) && !memory.context.commitment_accepted) {
    logger.info(`Handoff triggered para lead ${params.leadId} (score: ${newHandoffScore})`);

    const handoffReply = await generateReply(
      memory,
      SPECIAL_RESPONSES.HANDOFF_READY,
      params.userMessage
    );

    addMessage(memory.conversationId, 'assistant', handoffReply);
    await persistConversation(memory, 'negotiating', true);

    return {
      reply: handoffReply,
      spinStage: memory.spinStage,
      handoffTriggered: true,
      handoffScore: newHandoffScore,
      contextUpdated: {},
      nextAction: 'handoff',
    };
  }

  // Extrair e atualizar contexto da mensagem
  const contextUpdates = extractContextFromMessage(params.userMessage, memory.context);
  if (Object.keys(contextUpdates).length > 0) {
    updateContext(memory.conversationId, contextUpdates);
  }

  // Verificar se o lead aceitou o micro compromisso
  const acceptedCommitment = signals.includes('responded_positively') &&
    (memory.spinStage === 'commitment' || memory.spinStage === 'biz_commitment');

  if (acceptedCommitment) {
    updateContext(memory.conversationId, { commitment_accepted: true });
  }

  // Construir prompt para a etapa atual
  const stagePrompt = buildStagePrompt(memory);

  // Gerar resposta com IA
  const reply = await generateReply(memory, stagePrompt, params.userMessage);

  // Adicionar resposta do assistente à memória
  addMessage(memory.conversationId, 'assistant', reply);

  // Verificar próxima ação
  let nextAction: ConversationResult['nextAction'] = 'continue';
  const currentStage = memory.spinStage;

  // Decidir se avança para próxima etapa
  const shouldAdvance = shouldAdvanceStage(memory, signals, params.userMessage);
  if (shouldAdvance) {
    const nextStage = advanceStage(memory.conversationId);
    if (nextStage === 'transition') {
      nextAction = 'request_whatsapp';
    }
  }

  // Persistir no banco
  await persistConversation(memory, 'active', false);

  return {
    reply,
    spinStage: currentStage,
    handoffTriggered: false,
    handoffScore: newHandoffScore,
    contextUpdated: contextUpdates,
    nextAction,
  };
}

// ============================================================
// GERAR RESPOSTA COM A API CLAUDE
// ============================================================
async function generateReply(
  memory: LeadMemory,
  stagePrompt: string,
  userMessage: string
): Promise<string> {
  // Construir histórico de mensagens para o Claude
  const messages: Anthropic.MessageParam[] = [];

  // Adicionar histórico da conversa (últimas 10 mensagens para eficiência)
  const recentMessages = memory.messages.slice(-10);
  for (const msg of recentMessages) {
    messages.push({
      role: msg.role,
      content: msg.content,
    });
  }

  // Adicionar a mensagem atual do usuário se não estiver no histórico
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage || lastMessage.role !== 'user' || lastMessage.content !== userMessage) {
    messages.push({ role: 'user', content: userMessage });
  }

  // System prompt combinado: persona + instrução de etapa
  const systemPrompt = `${PELICANO_SYSTEM_PROMPT}

## INSTRUÇÃO PARA ESTA MENSAGEM
${stagePrompt}

## CONTEXTO COLETADO ATÉ AGORA
${JSON.stringify(memory.context, null, 2)}

## REGRA CRÍTICA
Responda APENAS com o texto da mensagem para o lead.
Sem introduções, sem meta-comentários, sem aspas.
Máximo de 3-4 frases. Seja natural e humano.`;

  // Retry com backoff exponencial (3 tentativas)
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const t0 = Date.now();
      const response = await anthropic.messages.create({
        model: config.anthropic.model,
        max_tokens: config.anthropic.maxTokens,
        system: systemPrompt,
        messages,
      });
      logger.debug(`Claude respondeu em ${Date.now() - t0}ms (tentativa ${attempt})`);

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Resposta inesperada da API');
      }

      return content.text.trim();
    } catch (error) {
      logger.warn(`Tentativa ${attempt}/${MAX_RETRIES} falhou ao gerar resposta com Claude`, error);
      if (attempt === MAX_RETRIES) {
        logger.error('Todas as tentativas esgotadas. Retornando fallback.');
        // Fallback para não deixar o usuário sem resposta
        return 'Oi! Recebi sua mensagem. Me dá um instante que já te respondo 😊';
      }
      // Aguarda antes de tentar novamente: 2s, 4s
      await new Promise(res => setTimeout(res, attempt * 2000));
    }
  }
  // Typescript precisa de return aqui mas nunca chega
  return 'Oi! Me dá um instante 😊';
}

// ============================================================
// LÓGICA DE AVANÇO DE ETAPA
// ============================================================
function shouldAdvanceStage(
  memory: LeadMemory,
  signals: string[],
  userMessage: string
): boolean {
  const { spinStage } = memory;
  const positiveResponse = signals.includes('responded_positively') ||
    signals.includes('expressed_interest') ||
    signals.includes('shared_pain');

  // Avança após quebra-gelo se respondeu de forma engajada
  if (spinStage === 'ice_break' && userMessage.length > 20) return true;

  // Avança de situação após lead compartilhar contexto
  if (spinStage === 'situation' && userMessage.length > 30) return true;

  // Avança de problema após identificar dor
  if (spinStage === 'problem' && (signals.includes('shared_pain') || userMessage.length > 20)) return true;

  // Avança de implicação para compromisso
  if (spinStage === 'implication' && positiveResponse) return true;

  // Avança de compromisso após aceitação
  if (spinStage === 'commitment' && positiveResponse) return true;

  return false;
}

// ============================================================
// PERSISTIR CONVERSA NO BANCO
// ============================================================
async function persistConversation(
  memory: LeadMemory,
  status: string,
  handoffTriggered: boolean
): Promise<void> {
  const serialized = serializeMemory(memory.conversationId);
  if (!serialized) return;

  try {
    await db.conversations.update(memory.conversationId, {
      spin_stage: serialized.spinStage,
      messages: serialized.messages,
      context_data: serialized.contextData,
      status,
      handoff_triggered: handoffTriggered,
      converted_at: status === 'converted' ? new Date().toISOString() : null,
    });
  } catch (error) {
    logger.error('Erro ao persistir conversa', error);
  }
}

// ============================================================
// INICIAR CONVERSA (para quando o PELÍCANO aborda primeiro)
// ============================================================
export async function initiateConversation(params: {
  leadId: string;
  consultantId: string;
  channel: string;
  sourceContext: string;
  leadName?: string;
  profileType?: 'product' | 'business' | 'both';
}): Promise<string> {
  const initialContext: Partial<LeadContextData> = {
    name: params.leadName,
    profile_type: params.profileType ?? 'product',
  };

  // Adicionar source_context ao objeto de contexto
  const contextWithSource = {
    ...initialContext,
    source_context: params.sourceContext,
  } as Partial<LeadContextData>;

  const memory = await getOrCreateConversation({
    leadId: params.leadId,
    consultantId: params.consultantId,
    channel: params.channel,
    initialContext: contextWithSource,
  });

  // Gerar quebra-gelo inicial (sem source_context no prompt para não vazar contexto)
  const promptContext: Partial<LeadContextData> = { ...contextWithSource };
  delete promptContext.source_context;

  const iceBreakPrompt = params.profileType === 'business'
    ? BUSINESS_SPIN_STAGES.ICE_BREAK.prompt(promptContext)
    : SPIN_STAGES.ICE_BREAK.prompt(promptContext);

  const dummyMessage = '[início da conversa]';
  const reply = await generateReply(memory, iceBreakPrompt, dummyMessage);

  addMessage(memory.conversationId, 'assistant', reply);
  await persistConversation(memory, 'active', false);

  return reply;
}
