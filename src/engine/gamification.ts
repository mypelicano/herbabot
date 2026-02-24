/**
 * Motor de Gamificação do PELÍCANO™
 *
 * Controla: XP, níveis, streaks, badges, desafios e rankings.
 * O objetivo é criar engajamento diário que aumente retenção e recompra.
 */

import { createLogger } from '../lib/logger.js';
import { db } from '../database/client.js';
import type { ClientGamification, ClientProject } from '../database/client.js';

const logger = createLogger('GAMIFICATION');

// ============================================================
// DEFINIÇÃO DE XP POR AÇÃO
// ============================================================
export const XP_REWARDS = {
  CHECKIN_DAILY: 10,        // check-in diário realizado
  SHAKE_AM: 15,             // shake da manhã tomado
  SHAKE_PM: 15,             // shake da tarde/noite tomado
  HYDRATION: 10,            // tomou 2L de água
  SUPPLEMENT: 10,           // tomou suplemento
  WEIGHT_LOGGED: 20,        // registrou peso
  PHOTO_SHARED: 50,         // compartilhou foto de resultado
  REFERRAL: 100,            // indicou um amigo
  CHALLENGE_COMPLETE: 200,  // completou desafio de 21 dias
  STREAK_7: 70,             // streak de 7 dias (bônus)
  STREAK_14: 140,           // streak de 14 dias (bônus)
  STREAK_21: 210,           // streak de 21 dias (bônus)
  STREAK_30: 300,           // streak de 30 dias (bônus)
} as const;

// ============================================================
// DEFINIÇÃO DE BADGES (narrativos, não genéricos)
// ============================================================
export type Badge = {
  id: string;
  emoji: string;
  name: string;
  description: string;
  condition: (stats: GamificationStats) => boolean;
  message: string; // mensagem enviada quando conquistar
};

export type GamificationStats = {
  streak: number;
  xpTotal: number;
  level: number;
  checkinCount: number;
  weightLost: number;
  referrals: number;
  challengesCompleted: number;
};

export const BADGES: Badge[] = [
  {
    id: 'first_step',
    emoji: '🌱',
    name: 'Primeiro Passo',
    description: 'Completou a primeira semana',
    condition: (s) => s.streak >= 7,
    message: '🌱 *Badge conquistado: PRIMEIRO PASSO!*\n\n7 dias de consistência! Você começou sua transformação. O mais difícil já passou.',
  },
  {
    id: 'energy_warrior',
    emoji: '💪',
    name: 'Guerreira da Energia',
    description: 'Streak de 10 dias',
    condition: (s) => s.streak >= 10,
    message: '💪 *Badge conquistado: GUERREIRA DA ENERGIA!*\n\n10 dias sem falhar! Seu corpo já está sentindo a diferença — e você também.',
  },
  {
    id: 'transformation_mode',
    emoji: '🔥',
    name: 'Modo Transformação',
    description: 'Perdeu os primeiros 2kg',
    condition: (s) => s.weightLost >= 2,
    message: '🔥 *Badge conquistado: MODO TRANSFORMAÇÃO!*\n\nPrimeiros 2kg a menos! Isso é real, é seu, e ninguém pode tirar. Continue!',
  },
  {
    id: 'living_example',
    emoji: '⭐',
    name: 'Exemplo Vivo',
    description: 'Compartilhou resultado com alguém',
    condition: (s) => s.referrals >= 1,
    message: '⭐ *Badge conquistado: EXEMPLO VIVO!*\n\nVocê inspirou alguém hoje. Isso é mais poderoso do que qualquer produto.',
  },
  {
    id: 'invincible_30',
    emoji: '🏆',
    name: '30 Dias Invicto',
    description: 'Streak de 30 dias completos',
    condition: (s) => s.streak >= 30,
    message: '🏆 *Badge conquistado: 30 DIAS INVICTO!*\n\nVocê fez o que 99% das pessoas não conseguem: 30 dias de consistência absoluta. Você é incrível.',
  },
  {
    id: 'health_ambassador',
    emoji: '👑',
    name: 'Embaixadora da Saúde',
    description: 'Indicou 3 amigos',
    condition: (s) => s.referrals >= 3,
    message: '👑 *Badge conquistado: EMBAIXADORA DA SAÚDE!*\n\nVocê transformou sua vida e está transformando a vida de outras pessoas. Isso é liderança.',
  },
  {
    id: 'level_5',
    emoji: '🌟',
    name: 'Nível Transformador',
    description: 'Atingiu nível 5',
    condition: (s) => s.level >= 5,
    message: '🌟 *Badge conquistado: NÍVEL TRANSFORMADOR!*\n\nNível 5 alcançado! Você está no topo da nossa comunidade.',
  },
];

// ============================================================
// TABELA DE NÍVEIS (XP necessário)
// ============================================================
const LEVEL_XP_THRESHOLDS = [
  0,    // Nível 1
  100,  // Nível 2 — Comprometida
  300,  // Nível 3 — Guerreira
  700,  // Nível 4 — Transformadora
  1500, // Nível 5 — Embaixadora
  3000, // Nível 6 — Campeã
];

export const LEVEL_NAMES = [
  '',
  'Iniciante',
  'Comprometida',
  'Guerreira',
  'Transformadora',
  'Embaixadora',
  'Campeã',
];

export function calculateLevel(xpTotal: number): number {
  let level = 1;
  for (let i = LEVEL_XP_THRESHOLDS.length - 1; i >= 0; i--) {
    if (xpTotal >= LEVEL_XP_THRESHOLDS[i]) {
      level = i + 1;
      break;
    }
  }
  return Math.min(level, LEVEL_NAMES.length - 1);
}

export function xpToNextLevel(xpTotal: number): number {
  const level = calculateLevel(xpTotal);
  const nextThreshold = LEVEL_XP_THRESHOLDS[level] ?? Infinity;
  return Math.max(0, nextThreshold - xpTotal);
}

// ============================================================
// PROCESSAR GANHO DE XP
// ============================================================
export async function awardXP(
  projectId: string,
  action: keyof typeof XP_REWARDS,
  extraXp: number = 0
): Promise<{ newXp: number; newLevel: number; levelUp: boolean }> {
  const xpGained = XP_REWARDS[action] + extraXp;

  // Buscar gamificação atual
  const { data: gam } = await db.client
    .from('client_gamification')
    .select('xp_total, level')
    .eq('project_id', projectId)
    .single();

  const current = gam as { xp_total: number; level: number } | null;
  if (!current) throw new Error(`Gamificação não encontrada para projeto ${projectId}`);

  const newXp = current.xp_total + xpGained;
  const newLevel = calculateLevel(newXp);
  const levelUp = newLevel > current.level;

  await db.client
    .from('client_gamification')
    .update({ xp_total: newXp, level: newLevel })
    .eq('project_id', projectId);

  logger.info(`XP awardado: +${xpGained} (${action}) → total ${newXp} | Level ${newLevel}`);
  return { newXp, newLevel, levelUp };
}

// ============================================================
// PROCESSAR CHECK-IN E ATUALIZAR STREAK
// ============================================================
export type CheckinData = {
  shakeAm: boolean;
  shakePm: boolean;
  hydrationOk: boolean;
  supplementOk: boolean;
  weightKg?: number;
  mood?: number;
};

export type CheckinResult = {
  xpEarned: number;
  newStreak: number;
  streakBonus: boolean;
  badgesUnlocked: Badge[];
  levelUp: boolean;
  newLevel: number;
  message: string;
};

export async function processCheckin(
  projectId: string,
  data: CheckinData
): Promise<CheckinResult> {
  // Verificar se já fez check-in hoje
  const today = new Date().toISOString().split('T')[0];
  const { data: existing } = await db.client
    .from('daily_checkins')
    .select('id')
    .eq('project_id', projectId)
    .eq('checkin_date', today)
    .single();

  if (existing) {
    logger.info(`Check-in já realizado hoje para projeto ${projectId}`);
    return {
      xpEarned: 0,
      newStreak: 0,
      streakBonus: false,
      badgesUnlocked: [],
      levelUp: false,
      newLevel: 1,
      message: 'Você já fez seu check-in hoje! Volte amanhã 😊',
    };
  }

  // Calcular XP ganho
  let xpEarned = XP_REWARDS.CHECKIN_DAILY;
  if (data.shakeAm)       xpEarned += XP_REWARDS.SHAKE_AM;
  if (data.shakePm)       xpEarned += XP_REWARDS.SHAKE_PM;
  if (data.hydrationOk)   xpEarned += XP_REWARDS.HYDRATION;
  if (data.supplementOk)  xpEarned += XP_REWARDS.SUPPLEMENT;
  if (data.weightKg)      xpEarned += XP_REWARDS.WEIGHT_LOGGED;

  // Salvar check-in
  await db.client.from('daily_checkins').insert({
    project_id: projectId,
    checkin_date: today,
    shake_am: data.shakeAm,
    shake_pm: data.shakePm,
    hydration_ok: data.hydrationOk,
    supplement_ok: data.supplementOk,
    weight_kg: data.weightKg ?? null,
    mood: data.mood ?? null,
    xp_earned: xpEarned,
  });

  // Atualizar peso se informado
  if (data.weightKg) {
    await db.client
      .from('client_projects')
      .update({ current_weight_kg: data.weightKg })
      .eq('id', projectId);
  }

  // Calcular novo streak
  const newStreak = await updateStreak(projectId);

  // Verificar bônus de streak
  let streakBonus = false;
  const bonusXp = getStreakBonusXp(newStreak);
  if (bonusXp > 0) {
    xpEarned += bonusXp;
    streakBonus = true;
  }

  // Processar XP total
  const { newLevel, levelUp } = await awardXP(projectId, 'CHECKIN_DAILY', xpEarned - XP_REWARDS.CHECKIN_DAILY);

  // Verificar badges desbloqueados
  const badgesUnlocked = await checkAndAwardBadges(projectId, newStreak, newLevel);

  // Increment manual dos contadores de check-in
  const { data: gamCounts } = await db.client
    .from('client_gamification')
    .select('checkin_count_total, checkin_count_30d')
    .eq('project_id', projectId)
    .single();

  const counts = gamCounts as { checkin_count_total: number; checkin_count_30d: number } | null;
  await db.client
    .from('client_gamification')
    .update({
      checkin_count_total: (counts?.checkin_count_total ?? 0) + 1,
      checkin_count_30d: (counts?.checkin_count_30d ?? 0) + 1,
      last_checkin_at: new Date().toISOString(),
    })
    .eq('project_id', projectId);

  const message = buildCheckinResponseMessage({
    xpEarned,
    newStreak,
    streakBonus,
    levelUp,
    newLevel,
    badgesUnlocked,
    data,
  });

  logger.info(`Check-in processado: projeto ${projectId}, streak ${newStreak}, XP +${xpEarned}`);

  return { xpEarned, newStreak, streakBonus, badgesUnlocked, levelUp, newLevel, message };
}

// ============================================================
// ATUALIZAR STREAK
// ============================================================
async function updateStreak(projectId: string): Promise<number> {
  const { data: gam } = await db.client
    .from('client_gamification')
    .select('current_streak, max_streak, last_checkin_at')
    .eq('project_id', projectId)
    .single();

  const g = gam as { current_streak: number; max_streak: number; last_checkin_at: string | null } | null;
  if (!g) return 1;

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  const lastCheckin = g.last_checkin_at?.split('T')[0];
  const isConsecutive = lastCheckin === yesterdayStr;

  const newStreak = isConsecutive ? g.current_streak + 1 : 1;
  const newMax = Math.max(g.max_streak, newStreak);

  await db.client
    .from('client_gamification')
    .update({ current_streak: newStreak, max_streak: newMax })
    .eq('project_id', projectId);

  return newStreak;
}

// ============================================================
// BÔNUS DE XP POR STREAK
// ============================================================
function getStreakBonusXp(streak: number): number {
  if (streak === 7)  return XP_REWARDS.STREAK_7;
  if (streak === 14) return XP_REWARDS.STREAK_14;
  if (streak === 21) return XP_REWARDS.STREAK_21;
  if (streak === 30) return XP_REWARDS.STREAK_30;
  return 0;
}

// ============================================================
// VERIFICAR E CONCEDER BADGES
// ============================================================
async function checkAndAwardBadges(
  projectId: string,
  currentStreak: number,
  currentLevel: number
): Promise<Badge[]> {
  // Buscar gamificação atual + dados do projeto
  const { data: gam } = await db.client
    .from('client_gamification')
    .select('badges, xp_total')
    .eq('project_id', projectId)
    .single();

  const { data: proj } = await db.client
    .from('client_projects')
    .select('start_weight_kg, current_weight_kg')
    .eq('id', projectId)
    .single();

  const g = gam as { badges: string[]; xp_total: number } | null;
  const p = proj as { start_weight_kg: number | null; current_weight_kg: number | null } | null;

  if (!g) return [];

  const earnedBadgeIds = new Set(g.badges);
  const weightLost = (p?.start_weight_kg && p?.current_weight_kg)
    ? p.start_weight_kg - p.current_weight_kg
    : 0;

  const stats: GamificationStats = {
    streak: currentStreak,
    xpTotal: g.xp_total,
    level: currentLevel,
    checkinCount: 0, // simplificado
    weightLost,
    referrals: 0,    // simplificado — expandir depois
    challengesCompleted: 0,
  };

  const newBadges: Badge[] = [];

  for (const badge of BADGES) {
    if (!earnedBadgeIds.has(badge.id) && badge.condition(stats)) {
      newBadges.push(badge);
      earnedBadgeIds.add(badge.id);
    }
  }

  if (newBadges.length > 0) {
    await db.client
      .from('client_gamification')
      .update({ badges: Array.from(earnedBadgeIds) })
      .eq('project_id', projectId);

    logger.info(`${newBadges.length} badge(s) desbloqueado(s): ${newBadges.map(b => b.id).join(', ')}`);
  }

  return newBadges;
}

// ============================================================
// CONSTRUIR MENSAGEM DE RESPOSTA AO CHECK-IN
// ============================================================
function buildCheckinResponseMessage(params: {
  xpEarned: number;
  newStreak: number;
  streakBonus: boolean;
  levelUp: boolean;
  newLevel: number;
  badgesUnlocked: Badge[];
  data: CheckinData;
}): string {
  const { xpEarned, newStreak, streakBonus, levelUp, newLevel, badgesUnlocked, data } = params;

  const lines: string[] = [];

  // Confirmação dos itens do check-in
  lines.push(`✅ *Check-in do dia registrado!*`, ``);
  lines.push(`${data.shakeAm ? '✅' : '❌'} Shake manhã`);
  lines.push(`${data.shakePm ? '✅' : '❌'} Shake noite`);
  lines.push(`${data.hydrationOk ? '✅' : '❌'} 2L de água`);
  lines.push(`${data.supplementOk ? '✅' : '❌'} Suplemento`);
  if (data.weightKg) lines.push(`⚖️ Peso: ${data.weightKg}kg registrado`);
  lines.push(``);

  // XP e streak
  lines.push(`⚡ *+${xpEarned} XP* ganhos hoje!`);

  const streakEmoji = newStreak >= 21 ? '🔥🔥🔥' : newStreak >= 14 ? '🔥🔥' : newStreak >= 7 ? '🔥' : '⭐';
  lines.push(`${streakEmoji} *Streak: ${newStreak} dias consecutivos*`);

  if (streakBonus) {
    lines.push(`🎉 *BÔNUS DE STREAK!* Dias seguidos valem mais XP!`);
  }

  // Level up
  if (levelUp) {
    lines.push(``, `🆙 *NÍVEL UP! Você chegou ao nível ${newLevel}: ${LEVEL_NAMES[newLevel]}!*`);
  }

  // Badges
  for (const badge of badgesUnlocked) {
    lines.push(``, badge.message);
  }

  // Motivação final
  lines.push(``);
  const motivations = [
    'Amanhã, mesmo horário! 💪',
    'Cada dia conta. Continue assim! 🌟',
    'Você está construindo a melhor versão de si mesma. 🌿',
    'A consistência é a chave — e você tem ela! 🔑',
  ];
  lines.push(motivations[newStreak % motivations.length]);

  return lines.join('\n');
}

// ============================================================
// GERAR RELATÓRIO DO PROJETO (para o consultor ou cliente)
// ============================================================
export async function generateProjectReport(projectId: string): Promise<string> {
  const { data: project } = await db.client
    .from('client_projects')
    .select('*, client_gamification(*)')
    .eq('id', projectId)
    .single();

  const proj = project as (ClientProject & { client_gamification: ClientGamification[] }) | null;
  if (!proj) return 'Projeto não encontrado.';

  const gam = proj.client_gamification?.[0];
  const daysActive = Math.floor(
    (Date.now() - new Date(proj.start_date).getTime()) / (24 * 60 * 60 * 1000)
  );
  const weightLost = proj.start_weight_kg && proj.current_weight_kg
    ? (proj.start_weight_kg - proj.current_weight_kg).toFixed(1)
    : null;

  return [
    `📊 *RELATÓRIO DO PROJETO*`,
    ``,
    `📦 Kit: ${proj.product_kit}`,
    `🎯 Objetivo: ${proj.goal_description}`,
    `📅 Dias ativos: ${daysActive}`,
    weightLost ? `⚖️ Peso perdido: ${weightLost}kg` : '',
    ``,
    `🎮 *Gamificação:*`,
    `   XP Total: ${gam?.xp_total ?? 0}`,
    `   Nível: ${gam?.level ?? 1} — ${LEVEL_NAMES[gam?.level ?? 1]}`,
    `   Streak atual: ${gam?.current_streak ?? 0} dias 🔥`,
    `   Maior streak: ${gam?.max_streak ?? 0} dias`,
    `   Check-ins: ${gam?.checkin_count_total ?? 0} no total`,
    `   Badges: ${(gam?.badges ?? []).length} conquistados`,
  ].filter(Boolean).join('\n');
}
