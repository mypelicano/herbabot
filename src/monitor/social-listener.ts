/**
 * Monitor de Redes Sociais
 *
 * Detecta sinais de intenção em Instagram, TikTok e grupos de WhatsApp.
 * Analisa comentários, stories, bios e hashtags relacionadas à transformação,
 * saúde, emagrecimento e renda extra — o território do PELÍCANO.
 */

import { createLogger } from '../lib/logger.js';
import { scoreIntent } from '../engine/intent-scorer.js';

const logger = createLogger('SOCIAL-LISTENER');

// ============================================================
// CONFIGURAÇÃO DE KEYWORDS
// Divididas por categoria de intenção
// ============================================================
export const INTENT_KEYWORDS = {
  // Alta intenção de produto (emagrecer, saúde, disposição)
  product_high: [
    'quero emagrecer', 'preciso perder peso', 'cansada de me sentir assim',
    'sem disposição', 'sem energia', 'não consigo emagrecer', 'já tentei de tudo',
    'dieta não funciona', 'metabolismo lento', 'efeito sanfona',
    'quero me sentir bem', 'corpo que eu mereço', 'transformação corporal',
    'perdi X kg', 'perdi peso', 'emagrecimento', 'shake', 'herbalife',
    'nutrição', 'proteína', 'colágeno', 'suplemento',
  ],

  // Intenção de negócio (renda extra, empreendedorismo)
  business_high: [
    'renda extra', 'trabalhar de casa', 'ser minha própria chefe',
    'sair do emprego', 'demitida', 'precisando de dinheiro',
    'quero empreender', 'negócio próprio', 'liberdade financeira',
    'indicações', 'indicar produtos', 'ganhar dinheiro online',
    'mães empreendedoras', 'trabalho home office',
  ],

  // Urgência (gatilhos temporais)
  urgency: [
    'até o verão', 'festa de casamento', 'formatura', 'viagem',
    'agora', 'urgente', 'preciso rápido', 'mês que vem',
    'não aguento mais', 'último recurso', 'desesperada',
  ],

  // Hashtags alvo (Instagram/TikTok)
  hashtags: [
    '#emagrecimento', '#perderpeso', '#vidasaudavel', '#saudeequalidade',
    '#transformacaocorporal', '#herbalife', '#shakelife', '#saude',
    '#fitness', '#dieta', '#alimentacaosaudavel', '#bemestar',
    '#rendaextra', '#trabalheemcasa', '#empreendedorismo',
    '#negocioproprio', '#libertadefinanceira', '#maeempreendedora',
  ],
};

// ============================================================
// TIPOS
// ============================================================
export type SocialPlatform = 'instagram' | 'tiktok' | 'whatsapp_group' | 'facebook' | 'manychat';

export type SocialSignal = {
  platform: SocialPlatform;
  profileId: string;          // username ou ID externo
  profileName?: string;
  profileBio?: string;
  messageText: string;
  postUrl?: string;
  detectedAt: Date;
  intentScore: {
    productScore: number;
    businessScore: number;
    urgencyScore: number;
    total: number;
  };
  matchedKeywords: string[];
  priority: 'hot' | 'warm' | 'cold';
};

// ============================================================
// ANALISAR TEXTO PARA SINAIS DE INTENÇÃO
// ============================================================
export function analyzeText(params: {
  platform: SocialPlatform;
  profileId: string;
  profileName?: string;
  profileBio?: string;
  messageText: string;
  postUrl?: string;
}): SocialSignal | null {
  const fullText = [
    params.messageText,
    params.profileBio ?? '',
    params.profileName ?? '',
  ].join(' ').toLowerCase();

  const matched: string[] = [];

  // Checar todas as categorias de keywords
  for (const [, keywords] of Object.entries(INTENT_KEYWORDS)) {
    for (const kw of keywords) {
      if (fullText.includes(kw.toLowerCase().replace('#', ''))) {
        matched.push(kw);
      }
    }
  }

  // Se não encontrou nada relevante, ignorar
  if (matched.length === 0) return null;

  const score = scoreIntent(fullText);
  const total = score.productScore + score.businessScore + score.urgencyScore;

  // Mínimo de relevância para entrar na fila
  if (total < 20) return null;

  const priority: SocialSignal['priority'] =
    total >= 70 ? 'hot' :
    total >= 40 ? 'warm' :
    'cold';

  const signal: SocialSignal = {
    platform: params.platform,
    profileId: params.profileId,
    profileName: params.profileName,
    profileBio: params.profileBio,
    messageText: params.messageText,
    postUrl: params.postUrl,
    detectedAt: new Date(),
    intentScore: {
      productScore: score.productScore,
      businessScore: score.businessScore,
      urgencyScore: score.urgencyScore,
      total,
    },
    matchedKeywords: matched,
    priority,
  };

  logger.info(
    `Sinal detectado [${params.platform}] @${params.profileId} — score ${total} (${priority}) — keywords: ${matched.slice(0, 3).join(', ')}`
  );

  return signal;
}

// ============================================================
// PROCESSAR BATCH DE COMENTÁRIOS/POSTS
// Útil para análise offline de listas
// ============================================================
export function processBatch(items: Array<{
  platform: SocialPlatform;
  profileId: string;
  profileName?: string;
  messageText: string;
  postUrl?: string;
}>): SocialSignal[] {
  const signals: SocialSignal[] = [];

  for (const item of items) {
    const signal = analyzeText(item);
    if (signal) signals.push(signal);
  }

  // Ordenar por prioridade e score
  return signals.sort((a, b) => {
    const priorityOrder = { hot: 0, warm: 1, cold: 2 };
    const diff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (diff !== 0) return diff;
    return b.intentScore.total - a.intentScore.total;
  });
}
