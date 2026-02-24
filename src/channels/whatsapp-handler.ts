/**
 * Handler de Mensagens WhatsApp
 * Recebe eventos do webhook da Evolution API,
 * roteie para o motor de conversação e envia a resposta.
 */

import { createLogger } from '../lib/logger.js';
import { db } from '../database/client.js';
import { processMessage } from '../engine/conversation.js';
import { scoreIntent } from '../engine/intent-scorer.js';
import {
  sendText,
  sendTyping,
  markAsRead,
  extractMessageText,
  jidToPhone,
  type EvolutionMessage,
  type EvolutionWebhookPayload,
} from './whatsapp-client.js';
export type { EvolutionWebhookPayload } from './whatsapp-client.js';
import { enqueueSend, isWithinAllowedHours } from '../safety/rate-limiter.js';
import { v4 as uuidv4 } from 'uuid';
import { hasActiveCheckinSession, handleCheckinResponse } from '../engine/checkin-flow.js';
import { processReorderConfirmation } from '../pipeline/reorder-trigger.js';
import { triggerAudioIfHighScore } from '../media/audio-messages.js';

const logger = createLogger('WA-HANDLER');

// ============================================================
// MAPA DE TELEFONE → CONSULTOR
// Cache local para evitar query no banco a cada mensagem
// ============================================================
const phoneConsultantCache = new Map<string, string>();

async function findConsultantByPhone(phone: string): Promise<string | null> {
  if (phoneConsultantCache.has(phone)) {
    return phoneConsultantCache.get(phone)!;
  }

  // Busca no banco pelo telefone da instância (número do consultor)
  // Na prática, cada instância Evolution = 1 consultor
  // Então buscamos o consultor pelo campo `phone` na tabela consultants
  const { data } = await db.client
    .from('consultants')
    .select('id')
    .eq('phone', phone)
    .eq('active', true)
    .single();

  const consultantId = (data as { id: string } | null)?.id ?? null;
  if (consultantId) {
    phoneConsultantCache.set(phone, consultantId);
  }
  return consultantId;
}

// ============================================================
// OBTER OU CRIAR LEAD PELO NÚMERO
// ============================================================
async function getOrCreateLead(params: {
  phone: string;
  consultantId: string;
  pushName?: string;
}): Promise<string> {
  // Tentar encontrar lead existente
  const existingLead = await db.leads.findByPhone(params.phone);
  if (existingLead) return existingLead.id;

  // Criar novo lead
  const newLead = await db.leads.create({
    consultant_id: params.consultantId,
    platform: 'whatsapp',
    username: null,
    full_name: params.pushName ?? null,
    phone: params.phone,
    source_context: null,
    profile_url: null,
  });

  // Criar score inicial
  const initialScore = scoreIntent(params.pushName ?? '');
  await db.leadScores.upsert(newLead.id, {
    product_score: initialScore.productScore,
    business_score: initialScore.businessScore,
    urgency_score: initialScore.urgencyScore,
    stage: 'whatsapp',
  });

  logger.info(`Novo lead criado via WhatsApp: ${params.phone.substring(0, 6)}...`);
  return newLead.id;
}

// ============================================================
// PROCESSAR MENSAGEM RECEBIDA
// ============================================================
async function handleIncomingMessage(
  message: EvolutionMessage,
  consultantPhone: string
): Promise<void> {
  // Ignorar mensagens enviadas pelo próprio bot
  if (message.key.fromMe) return;

  const senderJid = message.key.remoteJid;

  // Ignorar grupos
  if (senderJid.endsWith('@g.us')) return;

  const senderPhone = jidToPhone(senderJid);
  const messageText = extractMessageText(message);

  // Ignorar mensagens sem texto (áudios, imagens sem legenda por enquanto)
  if (!messageText || messageText.trim().length === 0) {
    logger.debug(`Mensagem sem texto ignorada de ${senderPhone.substring(0, 6)}...`);
    return;
  }

  logger.info(`Mensagem recebida de ${senderPhone.substring(0, 6)}...: "${messageText.substring(0, 50)}..."`);

  // Verificar horário permitido (8h–21h fuso de São Paulo)
  if (!isWithinAllowedHours()) {
    logger.warn(`Fora do horário permitido — ignorando mensagem de ${senderPhone.substring(0, 6)}... (responde 8h–21h)`);
    return;
  }

  // Encontrar consultor dono da instância
  const consultantId = await findConsultantByPhone(consultantPhone);
  if (!consultantId) {
    logger.warn(`Consultor não encontrado para instância ${consultantPhone}`);
    return;
  }

  // Obter ou criar lead
  const leadId = await getOrCreateLead({
    phone: senderPhone,
    consultantId,
    pushName: message.pushName,
  });

  // Marcar como lida (após um pequeno delay)
  setTimeout(async () => {
    try {
      await markAsRead(senderJid, message.key.id);
    } catch {
      // Não crítico
    }
  }, 1500);

  // ── ROTEADOR DE PRIORIDADE ─────────────────────────────
  // 1º: Check-in ativo? Rota para o fluxo de check-in
  // 2º: Recompra? Rota para confirmação de pedido
  // 3º: Motor SPIN de conversação (padrão)
  // ──────────────────────────────────────────────────────

  // Verificar sessão de check-in ativa
  if (hasActiveCheckinSession(senderPhone)) {
    const checkinResult = await handleCheckinResponse(senderPhone, messageText);
    if (checkinResult.handled && checkinResult.reply) {
      enqueueSend(senderPhone, async () => {
        await sendTyping(senderPhone, 1500);
        await sendText(senderPhone, checkinResult.reply!);
      });
      return;
    }
  }

  // Verificar confirmação de recompra (respondeu SIM para proposta de recompra)
  const isReorderConfirmation = /^(sim|s|yes|confirmo|quero|pode ser|ok)$/i.test(messageText.trim());
  if (isReorderConfirmation) {
    await processReorderConfirmation(leadId, consultantId, senderPhone).catch(() => {});
    // Mesmo se não for recompra, deixa o SPIN processar normalmente
  }

  // Processar com o motor de conversação
  enqueueSend(senderPhone, async () => {
    try {
      // Simular "digitando..." por alguns segundos
      const typingDuration = Math.min(messageText.length * 80, 4000);
      await sendTyping(senderPhone, typingDuration);

      const result = await processMessage({
        leadId,
        consultantId,
        channel: 'whatsapp',
        userMessage: messageText,
        initialContext: {
          name: message.pushName,
        },
      });

      // Enviar resposta
      await sendText(senderPhone, result.reply, { skipDelay: true });

      // Se handoff: notificar o consultor
      if (result.handoffTriggered) {
        await notifyConsultantHandoff(consultantId, senderPhone, leadId, messageText);
      }

      // Auto-trigger de áudio se score alto (não bloqueia a fila)
      if (result.handoffScore && result.handoffScore >= 75) {
        triggerAudioIfHighScore({
          phone: senderPhone,
          leadName: message.pushName,
          handoffScore: result.handoffScore,
        }).catch(() => {});
      }

    } catch (error) {
      logger.error('Erro ao processar mensagem WhatsApp', error);
    }
  });
}

// ============================================================
// NOTIFICAR CONSULTOR SOBRE HANDOFF
// ============================================================
async function notifyConsultantHandoff(
  consultantId: string,
  leadPhone: string,
  _leadId: string,
  lastMessage: string
): Promise<void> {
  // Buscar telefone do consultor
  const { data } = await db.client
    .from('consultants')
    .select('phone, name')
    .eq('id', consultantId)
    .single();

  const consultant = data as { phone: string; name: string } | null;
  if (!consultant) return;

  const notification = [
    `⚡ *PELÍCANO — Lead Qualificado*`,
    ``,
    `Um lead está pronto para fechar!`,
    ``,
    `📱 Número: +${leadPhone}`,
    `💬 Última mensagem: "${lastMessage.substring(0, 100)}"`,
    ``,
    `Acesse o painel para ver o histórico completo.`,
    ``,
    `_Respondido pela IA — agora é sua vez!_ 🦅`,
  ].join('\n');

  try {
    await sendText(consultant.phone, notification, { skipDelay: true });
    logger.info(`Consultor ${consultant.name} notificado sobre handoff`);
  } catch (error) {
    logger.error('Erro ao notificar consultor', error);
  }
}

// ============================================================
// PROCESSADOR PRINCIPAL DE EVENTOS DO WEBHOOK
// ============================================================
export async function handleWebhookEvent(
  payload: EvolutionWebhookPayload,
  instancePhone: string
): Promise<void> {
  logger.debug(`Evento recebido: ${payload.event}`);

  switch (payload.event) {
    case 'messages.upsert':
    case 'MESSAGES_UPSERT': {
      const message = payload.data as EvolutionMessage;
      await handleIncomingMessage(message, instancePhone);
      break;
    }

    case 'connection.update':
    case 'CONNECTION_UPDATE': {
      const connData = payload.data as { state?: string };
      logger.info(`Status da conexão: ${connData.state ?? 'desconhecido'}`);
      break;
    }

    default:
      logger.debug(`Evento ignorado: ${payload.event}`);
  }
}

// ============================================================
// ENVIAR MENSAGEM PROATIVA (PELÍCANO aborda primeiro)
// ============================================================
export async function sendProactiveMessage(params: {
  toPhone: string;
  message: string;
  consultantPhone: string;
}): Promise<boolean> {
  if (!isWithinAllowedHours()) {
    logger.warn('Mensagem proativa bloqueada: fora do horário permitido');
    return false;
  }

  try {
    enqueueSend(params.toPhone, async () => {
      await sendTyping(params.toPhone, 3000);
      await sendText(params.toPhone, params.message);
    });
    return true;
  } catch (error) {
    logger.error('Erro ao enviar mensagem proativa', error);
    return false;
  }
}

export { uuidv4 };
