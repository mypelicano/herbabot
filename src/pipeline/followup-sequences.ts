/**
 * Réguas de Mensagens Automatizadas
 *
 * RÉGUA 1: Follow-up de 7 dias pós-primeiro-contato (lead não convertido)
 * RÉGUA 2: Acompanhamento de 30 dias pós-compra (cliente ativo)
 */

import { createLogger } from '../lib/logger.js';
import { varyText, TEXT_VARIATIONS } from '../safety/rate-limiter.js';

const logger = createLogger('SEQUENCES');

// ============================================================
// TIPOS
// ============================================================
export type FollowupMessage = {
  dayOffset: number;          // dias após o evento inicial
  hourOfDay: number;          // hora ideal de envio (0-23)
  condition?: string;         // condição para enviar
  getText: (params: SequenceParams) => string;
};

export type SequenceParams = {
  name?: string;
  consultantName?: string;
  pain?: string;
  product?: string;
  result?: string;
  streak?: number;
  daysLeft?: number;
  weightLost?: number;
  groupName?: string;
};

// ============================================================
// RÉGUA 1: FOLLOW-UP PÓS-CONTATO (7 DIAS)
// Para leads que ainda não compraram
// ============================================================
export const FOLLOWUP_SEQUENCE: FollowupMessage[] = [
  {
    dayOffset: 1,
    hourOfDay: 10,
    getText: ({ name, pain }) => {
      const firstName = name?.split(' ')[0] ?? 'você';
      const oi = TEXT_VARIATIONS.greeting[Math.floor(Math.random() * TEXT_VARIATIONS.greeting.length)];
      const problema = pain ?? 'falta de energia';
      return varyText(
        `${oi} ${firstName}! Fiquei pensando na nossa conversa sobre ${problema}.\n\nTinha uma coisa que queria te mostrar — você tem 2 minutinhos?`,
        {}
      );
    },
  },
  {
    dayOffset: 2,
    hourOfDay: 18,
    getText: ({ name }) => {
      const firstName = name?.split(' ')[0] ?? 'você';
      return `${firstName}, uma cliente minha ${TEXT_VARIATIONS.emoji_health[0]} começou exatamente com o mesmo problema que você descreveu.\n\nEm 3 semanas ela me disse que mal lembrava como era se sentir tão mal.\n\nSe tiver curiosidade, posso te contar o que ela fez?`;
    },
  },
  {
    dayOffset: 3,
    hourOfDay: 9,
    getText: ({ name }) => {
      const firstName = name?.split(' ')[0] ?? 'você';
      return `${firstName}, separei um áudio rápido pra você — menos de 1 minuto.\n\nExplico exatamente o que tem me ajudado e ajudado outras pessoas com o que você está passando.\n\nPosso te enviar?`;
    },
  },
  {
    dayOffset: 5,
    hourOfDay: 11,
    getText: ({ name, pain }) => {
      const firstName = name?.split(' ')[0] ?? 'você';
      const problema = pain ?? 'isso';
      return `${firstName}, só passando pra saber...\n\nVocê conseguiu encontrar alguma solução pra ${problema}?\n\nSe ainda não, pode ser que o que faço ajude. Sem compromisso, é só me chamar ${TEXT_VARIATIONS.emoji_health[2]}`;
    },
  },
  {
    dayOffset: 7,
    hourOfDay: 14,
    getText: ({ name }) => {
      const firstName = name?.split(' ')[0] ?? 'você';
      return `${firstName}, última mensagem — prometo! ${TEXT_VARIATIONS.emoji_energy[0]}\n\nSe um dia quiser conversar sobre saúde e energia, sabe onde me encontrar.\n\nTorço pelo seu bem-estar de qualquer jeito! 🌿`;
    },
  },
];

// ============================================================
// RÉGUA 2: ACOMPANHAMENTO PÓS-COMPRA (30 DIAS)
// Para clientes com projeto ativo — a régua de retenção e recompra
// ============================================================
export const POSTPURCHASE_SEQUENCE: FollowupMessage[] = [
  {
    dayOffset: 1,
    hourOfDay: 9,
    getText: ({ name, product }) => {
      const firstName = name?.split(' ')[0] ?? 'você';
      return [
        `${firstName}, seja bem-vinda ao seu projeto de transformação! 🌟`,
        ``,
        `Preparei um plano personalizado pra você. Aqui vai o resumo dos seus primeiros 7 dias:`,
        ``,
        `☀️ *Manhã:* ${product ?? 'Shake Formula 1'} + 1 copo d'água (400ml)`,
        `🍽️ *Almoço:* Refeição normal — sem restrição extrema`,
        `🌙 *Noite:* Shake leve ou refeição balanceada`,
        `💧 *Meta de água:* 2 litros por dia`,
        ``,
        `Me avisa quando tomar o primeiro shake! Quero saber como você está se sentindo 💚`,
      ].join('\n');
    },
  },
  {
    dayOffset: 3,
    hourOfDay: 10,
    getText: ({ name, streak }) => {
      const firstName = name?.split(' ')[0] ?? 'você';
      const days = streak ?? 3;
      return [
        `${firstName}, ${days} dias! ${TEXT_VARIATIONS.emoji_energy[2]}`,
        ``,
        `Seu corpo ainda está se adaptando — é normal sentir pouca diferença agora.`,
        `A virada costuma acontecer entre os dias 7 e 14.`,
        ``,
        `Uma pergunta: como está a energia de manhã comparada à semana passada?`,
      ].join('\n');
    },
  },
  {
    dayOffset: 7,
    hourOfDay: 9,
    getText: ({ name, streak }) => {
      const firstName = name?.split(' ')[0] ?? 'você';
      const days = streak ?? 7;
      return [
        `🎉 *${firstName}, 1 SEMANA COMPLETA!*`,
        ``,
        `${days} dias de consistência — você está no top 30% dos meus clientes!`,
        ``,
        `Momento de fazer a primeira pesagem:`,
        `📊 Pese-se pela manhã, antes de comer, sem roupa`,
        ``,
        `Me manda o número — vou registrar no seu projeto! 💪`,
      ].join('\n');
    },
  },
  {
    dayOffset: 10,
    hourOfDay: 19,
    getText: ({ name }) => {
      const firstName = name?.split(' ')[0] ?? 'você';
      return [
        `${firstName}, já que você está chegando na segunda semana...`,
        ``,
        `Tenho um grupo de desafio que começa essa semana com outras pessoas`,
        `que estão no mesmo momento que você.`,
        ``,
        `É um grupo de apoio — sem cobrança, só motivação 💚`,
        ``,
        `Quer participar?`,
      ].join('\n');
    },
  },
  {
    dayOffset: 14,
    hourOfDay: 9,
    getText: ({ name, weightLost }) => {
      const firstName = name?.split(' ')[0] ?? 'você';
      const kg = weightLost ? `Você perdeu ${weightLost}kg! ` : '';
      return [
        `🏅 *${firstName}, 2 SEMANAS!* Você está arrasando!`,
        ``,
        `${kg}Sua consistência está valendo cada dia.`,
        ``,
        `Chegou a hora da foto de acompanhamento — ela vai te motivar MUITO`,
        `quando olhar daqui a 2 semanas.`,
        ``,
        `Me manda uma foto com o mesmo ângulo da primeira (de frente, de lado) 📸`,
      ].join('\n');
    },
  },
  {
    dayOffset: 21,
    hourOfDay: 10,
    getText: ({ name, streak, result }) => {
      const firstName = name?.split(' ')[0] ?? 'você';
      const days = streak ?? 21;
      return [
        `🔥 *${firstName}, 21 DIAS!*`,
        ``,
        `Você oficialmente formou um novo hábito.`,
        `A ciência comprova: 21 dias é o ponto de virada.`,
        ``,
        result ? `Resultado até agora: ${result}` : ``,
        ``,
        `${days} dias de streak — você ganhou o badge 🏆 "30 Dias Invicto".`,
        ``,
        `Os próximos 9 dias são pra consolidar. Você consegue!`,
      ].filter(Boolean).join('\n');
    },
  },
  {
    dayOffset: 25,
    hourOfDay: 11,
    condition: 'pre_reorder',
    getText: ({ name, product }) => {
      const firstName = name?.split(' ')[0] ?? 'você';
      return [
        `${firstName}, seu kit deve estar chegando no fim ${TEXT_VARIATIONS.emoji_health[0]}`,
        ``,
        `Você está a ${6} dias de completar 1 mês inteiro — um feito incrível.`,
        ``,
        `*Se parar agora, perde o ritmo que levou 25 dias pra construir.*`,
        ``,
        `Posso já separar o kit do próximo mês pra você?`,
        `Assim não tem risco de ficar um dia sem o ${product ?? 'shake'}.`,
      ].join('\n');
    },
  },
  {
    dayOffset: 28,
    hourOfDay: 10,
    condition: 'reorder_not_confirmed',
    getText: ({ name }) => {
      const firstName = name?.split(' ')[0] ?? 'você';
      return [
        `${firstName}, sobre o kit do mês 2 — hoje é o último dia pra garantir`,
        `entrega antes do seu kit acabar.`,
        ``,
        `Já tenho o kit separado no seu nome.`,
        `Confirma e eu processo agora?`,
      ].join('\n');
    },
  },
  {
    dayOffset: 30,
    hourOfDay: 9,
    getText: ({ name, weightLost, streak }) => {
      const firstName = name?.split(' ')[0] ?? 'você';
      const kg = weightLost ? `, perdeu ${weightLost}kg` : '';
      const days = streak ?? 30;
      return [
        `🏆 *${firstName}, 30 DIAS COMPLETOS!*`,
        ``,
        `Você fez parte do 1% que chega até aqui${kg}.`,
        `${days} dias de streak — você é INCRÍVEL!`,
        ``,
        `Ganhei o badge mais especial: 👑 *"Embaixadora da Saúde"*`,
        ``,
        `Posso te pedir uma coisa? Compartilha seu resultado com uma amiga`,
        `que esteja passando pelo que você estava passando 30 dias atrás.`,
        ``,
        `Você pode ser a virada que ela precisa 💚`,
      ].join('\n');
    },
  },
];

// ============================================================
// HELPER: CALCULAR MENSAGENS PENDENTES PARA HOJE
// ============================================================
export function getMessagesForToday(
  sequenceType: 'followup' | 'postpurchase',
  startDate: Date,
  sentDays: number[]
): FollowupMessage[] {
  const sequence = sequenceType === 'followup'
    ? FOLLOWUP_SEQUENCE
    : POSTPURCHASE_SEQUENCE;

  const now = new Date();
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysSinceStart = Math.floor((now.getTime() - startDate.getTime()) / msPerDay);

  return sequence.filter(msg => {
    // Já foi enviada?
    if (sentDays.includes(msg.dayOffset)) return false;
    // Está no dia certo (ou atrasada, mas não adiantada)?
    if (msg.dayOffset > daysSinceStart) return false;
    // É a hora certa?
    const currentHour = now.getHours();
    if (currentHour < msg.hourOfDay) return false;

    return true;
  });
}

logger.info('Réguas de follow-up carregadas', {
  followup: `${FOLLOWUP_SEQUENCE.length} mensagens (7 dias)`,
  postpurchase: `${POSTPURCHASE_SEQUENCE.length} mensagens (30 dias)`,
});
