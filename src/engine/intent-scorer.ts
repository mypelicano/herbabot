import { createLogger } from '../lib/logger.js';

const logger = createLogger('SCORER');

// ============================================================
// PALAVRAS-CHAVE POR CATEGORIA DE INTENÇÃO
// ============================================================

const PRODUCT_KEYWORDS = {
  // Sinais de DOR (alta intenção)
  high: [
    'não consigo emagrecer', 'sem energia', 'sempre cansada', 'sempre cansado',
    'não aguento mais', 'barriga não sai', 'já tentei tudo', 'nada funciona',
    'inchada', 'inchado', 'cansada o tempo todo', 'cansado o tempo todo',
    'me sentindo mal', 'sem disposição', 'preciso perder peso urgente',
    'estou desesperada', 'estou desesperado', 'parei de emagrecer',
    'fome o tempo todo', 'compulsão alimentar', 'não consigo parar de comer',
  ],
  // Sinais de BUSCA (média intenção)
  medium: [
    'perder peso', 'emagrecer', 'energia', 'cansaço', 'fadiga',
    'alimentação saudável', 'dieta', 'emagrecimento', 'detox', 'suplemento',
    'shake', 'proteína', 'vitamina', 'nutrição', 'saúde',
    'academia', 'treino', 'fitness', 'musculação', 'funcional',
    'barriga', 'peso', 'balança', 'quilos', 'kg',
  ],
  // Sinais de CURIOSIDADE (baixa intenção)
  low: [
    'receita saudável', 'smoothie', 'salada', 'alimentação', 'hábitos',
    'bem-estar', 'qualidade de vida', 'vida saudável', 'saúde e bem estar',
    'corpo', 'mente', 'equilíbrio', 'leveza',
  ],
};

const BUSINESS_KEYWORDS = {
  high: [
    'renda extra urgente', 'preciso de dinheiro', 'estou desempregado',
    'estou desempregada', 'saí do emprego', 'fui demitido', 'fui demitida',
    'quero empreender', 'quero meu próprio negócio', 'cansada de chefe',
    'cansado de chefe', 'trabalhar de casa', 'trabalhar em casa',
    'liberdade financeira', 'independência financeira',
  ],
  medium: [
    'renda extra', 'ganhar dinheiro', 'fazer uma grana', 'negócio próprio',
    'empreendedorismo', 'empreender', 'autônomo', 'autônoma',
    'freelancer', 'home office', 'trabalhar online', 'renda passiva',
    'investimento', 'crescimento financeiro', 'mercado digital',
  ],
  low: [
    'crescimento', 'oportunidade', 'futuro', 'sonho', 'meta financeira',
    'dinheiro', 'salário', 'renda', 'ganho', 'profissional',
  ],
};

const URGENCY_KEYWORDS = {
  high: [
    'urgente', 'agora', 'já', 'preciso logo', 'o mais rápido possível',
    'não posso esperar', 'semana que vem é casamento', 'evento',
    'formatura', 'viagem', 'foto', 'biquíni', 'prova',
  ],
  medium: [
    'esse mês', 'esse ano', 'em breve', 'logo', 'quero começar',
    'pensando em', 'considerando', 'avaliando',
  ],
  low: [
    'futuramente', 'um dia', 'talvez', 'quem sabe', 'quando der',
    'quando puder', 'mais pra frente',
  ],
};

// ============================================================
// TIPO DO SCORE
// ============================================================
export type IntentScore = {
  productScore: number;    // 0-100
  businessScore: number;   // 0-100
  urgencyScore: number;    // 0-100
  totalScore: number;      // média dos três
  primaryProfile: 'product' | 'business' | 'both' | 'none';
  priority: 'immediate' | 'nurturing' | 'passive';
  matchedKeywords: {
    product: string[];
    business: string[];
    urgency: string[];
  };
};

// ============================================================
// FUNÇÃO PRINCIPAL DE SCORING
// ============================================================
export function scoreIntent(text: string): IntentScore {
  const normalizedText = text.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // remove acentos para matching mais flexível

  const matchedKeywords = {
    product: [] as string[],
    business: [] as string[],
    urgency: [] as string[],
  };

  // --- Score de Produto ---
  let productRaw = 0;
  for (const keyword of PRODUCT_KEYWORDS.high) {
    if (normalizedText.includes(normalize(keyword))) {
      productRaw += 35;
      matchedKeywords.product.push(keyword);
    }
  }
  for (const keyword of PRODUCT_KEYWORDS.medium) {
    if (normalizedText.includes(normalize(keyword))) {
      productRaw += 15;
      matchedKeywords.product.push(keyword);
    }
  }
  for (const keyword of PRODUCT_KEYWORDS.low) {
    if (normalizedText.includes(normalize(keyword))) {
      productRaw += 5;
      matchedKeywords.product.push(keyword);
    }
  }

  // --- Score de Negócio ---
  let businessRaw = 0;
  for (const keyword of BUSINESS_KEYWORDS.high) {
    if (normalizedText.includes(normalize(keyword))) {
      businessRaw += 35;
      matchedKeywords.business.push(keyword);
    }
  }
  for (const keyword of BUSINESS_KEYWORDS.medium) {
    if (normalizedText.includes(normalize(keyword))) {
      businessRaw += 15;
      matchedKeywords.business.push(keyword);
    }
  }
  for (const keyword of BUSINESS_KEYWORDS.low) {
    if (normalizedText.includes(normalize(keyword))) {
      businessRaw += 5;
      matchedKeywords.business.push(keyword);
    }
  }

  // --- Score de Urgência ---
  let urgencyRaw = 0;
  for (const keyword of URGENCY_KEYWORDS.high) {
    if (normalizedText.includes(normalize(keyword))) {
      urgencyRaw += 40;
      matchedKeywords.urgency.push(keyword);
    }
  }
  for (const keyword of URGENCY_KEYWORDS.medium) {
    if (normalizedText.includes(normalize(keyword))) {
      urgencyRaw += 20;
      matchedKeywords.urgency.push(keyword);
    }
  }
  for (const keyword of URGENCY_KEYWORDS.low) {
    if (normalizedText.includes(normalize(keyword))) {
      urgencyRaw += 5;
      matchedKeywords.urgency.push(keyword);
    }
  }

  // Normalizar para 0-100
  const productScore = Math.min(100, productRaw);
  const businessScore = Math.min(100, businessRaw);
  const urgencyScore = Math.min(100, urgencyRaw);
  const totalScore = Math.round((productScore + businessScore + urgencyScore) / 3);

  // Perfil dominante
  let primaryProfile: IntentScore['primaryProfile'] = 'none';
  if (productScore >= 30 && businessScore >= 30) {
    primaryProfile = 'both';
  } else if (productScore >= 30) {
    primaryProfile = 'product';
  } else if (businessScore >= 30) {
    primaryProfile = 'business';
  }

  // Prioridade de abordagem
  let priority: IntentScore['priority'] = 'passive';
  if (totalScore >= 70 || urgencyScore >= 60) {
    priority = 'immediate';
  } else if (totalScore >= 40) {
    priority = 'nurturing';
  }

  const score: IntentScore = {
    productScore,
    businessScore,
    urgencyScore,
    totalScore,
    primaryProfile,
    priority,
    matchedKeywords,
  };

  logger.debug('Score calculado', {
    totalScore,
    primaryProfile,
    priority,
    keywords: matchedKeywords,
  });

  return score;
}

// ============================================================
// SCORE BASEADO EM COMPORTAMENTO DE CONVERSA
// ============================================================
export type ConversationSignal =
  | 'responded_positively'    // respondeu de forma positiva
  | 'asked_about_price'       // perguntou sobre preço
  | 'asked_how_to_start'      // perguntou como começar
  | 'expressed_interest'      // expressou interesse explícito
  | 'shared_pain'             // compartilhou uma dor real
  | 'accepted_commitment'     // aceitou o micro compromisso
  | 'went_cold'               // ficou frio/sem resposta
  | 'rejected'                // rejeitou explicitamente
  | 'asked_about_business';   // perguntou sobre o negócio

const SIGNAL_WEIGHTS: Record<ConversationSignal, number> = {
  responded_positively: 10,
  asked_about_price: 25,
  asked_how_to_start: 30,
  expressed_interest: 20,
  shared_pain: 15,
  accepted_commitment: 25,
  went_cold: -10,
  rejected: -40,
  asked_about_business: 20,
};

export function calculateHandoffScore(
  baseScore: number,
  signals: ConversationSignal[]
): number {
  const signalSum = signals.reduce((acc, signal) => acc + SIGNAL_WEIGHTS[signal], 0);
  return Math.max(0, Math.min(100, baseScore + signalSum));
}

export function shouldHandoff(handoffScore: number): boolean {
  return handoffScore >= 75;
}

// ============================================================
// DETECTAR SINAIS NA MENSAGEM DO LEAD
// ============================================================
export function detectConversationSignals(message: string): ConversationSignal[] {
  const signals: ConversationSignal[] = [];
  const text = message.toLowerCase();

  const priceTerms = ['quanto custa', 'quanto é', 'qual o valor', 'preço', 'valor', 'custo', 'investimento'];
  const startTerms = ['como começo', 'como compro', 'como fazer', 'como faço', 'quero começar', 'quero comprar'];
  const interestTerms = ['tenho interesse', 'gostei', 'quero saber mais', 'me conta mais', 'me explica', 'me manda', 'quero'];
  const painTerms = ['sofro', 'sofro com', 'me incomoda', 'me frustra', 'não consigo', 'tenho dificuldade', 'problema'];
  const businessTerms = ['negócio', 'ganhar dinheiro com', 'como funciona o negócio', 'como vender', 'ser consultor', 'ser consultora'];
  const positiveTerms = ['sim', 'claro', 'com certeza', 'ótimo', 'pode ser', 'tá bom', 'tudo bem', 'ok'];
  const coldTerms = ['não tenho interesse', 'não quero', 'deixa pra lá', 'não preciso', 'chega'];

  if (priceTerms.some(term => text.includes(term))) signals.push('asked_about_price');
  if (startTerms.some(term => text.includes(term))) signals.push('asked_how_to_start');
  if (interestTerms.some(term => text.includes(term))) signals.push('expressed_interest');
  if (painTerms.some(term => text.includes(term))) signals.push('shared_pain');
  if (businessTerms.some(term => text.includes(term))) signals.push('asked_about_business');
  if (positiveTerms.some(term => text.includes(term))) signals.push('responded_positively');
  if (coldTerms.some(term => text.includes(term))) signals.push('rejected');

  return signals;
}

// Utilitário interno
function normalize(text: string): string {
  return text.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}
