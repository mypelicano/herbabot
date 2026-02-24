/**
 * Mensagens de Áudio Personalizadas
 *
 * O PELÍCANO gera áudios personalizados com nome e contexto do lead.
 * Disparados automaticamente quando o score é alto (≥ 75),
 * ou quando o consultor quiser dar um toque mais humano.
 *
 * Por que áudio funciona:
 * - Taxa de abertura: 95% (vs 60% de texto)
 * - Conexão emocional muito maior
 * - Diferencia do spam de texto genérico
 * - Parece mensagem pessoal de uma amiga
 */

import { createLogger } from '../lib/logger.js';
import { config } from '../config/index.js';
import { generateAudio } from './elevenlabs-client.js';
import { sendAudio } from '../channels/whatsapp-client.js';
import { enqueueSend } from '../safety/rate-limiter.js';
import { isConfigured } from '../config/index.js';

const logger = createLogger('AUDIO-MSG');

// ============================================================
// TEMPLATES DE ÁUDIO
// ============================================================

/**
 * Áudio de abordagem inicial (score alto, não respondeu o texto)
 */
function scriptInitialApproach(params: {
  name?: string;
  pain?: string; // 'emagrecimento' | 'energia' | 'renda' | string
}): string {
  const firstName = params.name?.split(' ')[0];
  const greeting = firstName ? `Oi, ${firstName}!` : `Oi!`;

  if (params.pain?.includes('renda') || params.pain?.includes('negócio')) {
    return (
      `${greeting} Tudo bem? ` +
      `Aqui é a Consultora Herbalife. ` +
      `Vi que você estava procurando uma forma de gerar uma renda extra de casa. ` +
      `Tenho algo incrível pra te mostrar — outras mães já estão faturando muito bem ` +
      `sem precisar sair de casa. ` +
      `Me responde essa mensagem quando puder, tá? ` +
      `Mando mais informações!`
    );
  }

  return (
    `${greeting} Tudo bem? ` +
    `Aqui é a Consultora Herbalife. ` +
    `Vi que você está em busca de mais saúde e disposição — e eu adoro ajudar pessoas com isso! ` +
    `Já ajudei mais de 50 pessoas a atingirem o peso que queriam, ` +
    `com um método simples, sem sofrimento e sem passar fome. ` +
    `Me responde quando puder! Mando mais detalhes com prazer. `
  );
}

/**
 * Áudio de follow-up (lead não respondeu após 24h)
 */
function scriptFollowUp(params: { name?: string }): string {
  const firstName = params.name?.split(' ')[0];
  const greeting = firstName ? `${firstName}, oi!` : `Oi!`;
  return (
    `${greeting} ` +
    `Só passando pra deixar um oi rápido. ` +
    `Sei que você está ocupada, mas quero muito te ajudar a alcançar o resultado que você merece. ` +
    `Quando tiver uns minutinhos, me manda uma mensagem. ` +
    `Estou aqui! `
  );
}

/**
 * Áudio de parabéns por streak (gamificação)
 */
function scriptStreakCongrats(params: { name?: string; streak: number }): string {
  const firstName = params.name?.split(' ')[0] ?? 'campeã';
  return (
    `Parabéns, ${firstName}! ` +
    `Você completou ${params.streak} dias consecutivos — isso é incrível! ` +
    `Pouquíssimas pessoas chegam até aqui. ` +
    `Você está provando que é capaz, e eu estou torcendo muito por você! ` +
    `Continue assim! `
  );
}

/**
 * Áudio de recompra (dia 25)
 */
function scriptReorder(params: { name?: string; streak: number }): string {
  const firstName = params.name?.split(' ')[0] ?? 'você';
  return (
    `Oi ${firstName}! ` +
    `Olha como o tempo passou rápido! Você está com ${params.streak} dias de resultados incríveis. ` +
    `Seu kit está chegando no fim, e eu não quero que você perca esse ritmo que levou tanto tempo pra construir. ` +
    `Posso garantir o kit do próximo mês pra você? ` +
    `Confirma com SIM na mensagem e eu processo agora. `
  );
}

// ============================================================
// TIPOS DE AUDIO
// ============================================================
export type AudioType =
  | 'initial_approach'
  | 'follow_up'
  | 'streak_congrats'
  | 'reorder';

// ============================================================
// DISPARAR ÁUDIO PERSONALIZADO
// ============================================================
export async function sendPersonalizedAudio(params: {
  phone: string;
  type: AudioType;
  leadName?: string;
  pain?: string;
  streak?: number;
  voiceId?: string;
}): Promise<boolean> {
  if (!isConfigured.elevenlabs) {
    logger.warn('ElevenLabs não configurado — pulando envio de áudio');
    return false;
  }

  // Gerar o script correto
  let script: string;
  switch (params.type) {
    case 'initial_approach':
      script = scriptInitialApproach({ name: params.leadName, pain: params.pain });
      break;
    case 'follow_up':
      script = scriptFollowUp({ name: params.leadName });
      break;
    case 'streak_congrats':
      script = scriptStreakCongrats({ name: params.leadName, streak: params.streak ?? 7 });
      break;
    case 'reorder':
      script = scriptReorder({ name: params.leadName, streak: params.streak ?? 0 });
      break;
    default:
      return false;
  }

  try {
    // Gerar o áudio com ElevenLabs
    logger.info(`Gerando áudio "${params.type}" para ${params.phone.substring(0, 6)}...`);
    const audioBuffer = await generateAudio({
      text: script,
      voiceId: params.voiceId,
    });

    // Enfileirar o envio
    enqueueSend(params.phone, async () => {
      await sendAudio(params.phone, audioBuffer);
      logger.info(`Áudio "${params.type}" enviado para ${params.phone.substring(0, 6)}...`);
    });

    return true;
  } catch (error) {
    logger.error(`Erro ao gerar/enviar áudio "${params.type}"`, error);
    return false;
  }
}

// ============================================================
// AUTO-TRIGGER: ENVIAR ÁUDIO QUANDO SCORE É ALTO
// Chamado pelo motor de conversação após scoring
// ============================================================
export async function triggerAudioIfHighScore(params: {
  phone: string;
  leadName?: string;
  handoffScore: number;
  pain?: string;
  voiceId?: string;
}): Promise<void> {
  // Score >= 75: lead muito quente — áudio de impacto
  if (params.handoffScore >= 75) {
    // Delay configurável via AUDIO_TRIGGER_DELAY_MS (padrão 2 min)
    setTimeout(() => {
      sendPersonalizedAudio({
        phone: params.phone,
        type: 'initial_approach',
        leadName: params.leadName,
        pain: params.pain,
        voiceId: params.voiceId,
      }).catch(() => {});
    }, config.audio.triggerDelayMs);
  }
}
