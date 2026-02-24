/**
 * Grupos de Desafio — Bot Moderador
 *
 * Gerencia grupos de 7-15 clientes em desafios de 21 dias.
 * O PELÍCANO age como moderador: motiva, ranqueia, celebra vitórias.
 */

import { createLogger } from '../lib/logger.js';
import { db } from '../database/client.js';
import { sendText } from '../channels/whatsapp-client.js';
import { enqueueSend } from '../safety/rate-limiter.js';

const logger = createLogger('GROUPS');

// ============================================================
// MENSAGENS DO BOT MODERADOR
// ============================================================
const MORNING_MESSAGES = [
  '☀️ *Bom dia, turma!* Mais um dia de conquistas. Quem já tomou o shake? Manda ✅ pra gente saber! 💪',
  '🌅 *Despertando!* A diferença entre quem transforma e quem desiste é exatamente esse momento — agir quando não está com vontade. Vamos? ✅',
  '☀️ *Dia ${day} do desafio!* A turma está voando. Quem começou o dia certo? ✅ = sim, já tomei! 🚀',
  '🌟 *Bom dia, guerreiras!* O seu corpo agradece cada vez que você escolhe se cuidar. Dia ${day} — bora! ✅',
];

const EVENING_MESSAGES = [
  '🌙 *Check-in da noite!* Como foi o dia de hoje? Água em dia? Suplemento? Manda seu resumo! 💚',
  '⭐ *Fim do dia ${day}!* Cada dia completo é uma vitória. Quem fechou o dia com tudo? ✅✅✅',
  '🌙 *Revisão noturna:* ✅ Shake? ✅ Água? ✅ Suplemento? Manda sua pontuação do dia! 💪',
];

const CELEBRATION_MESSAGES = [
  '🎉 *MILESTONE ATINGIDO!* ${name} chegou ao dia ${day}! Aplausos! 👏👏👏',
  '🏅 *${name} desbloqueou um novo badge!* Que inspiração para a turma! 🌟',
  '💪 *Destaque do dia: ${name}!* Consistência é tudo — parabéns! 🔥',
];

const RANKING_TEMPLATE = (members: RankingMember[]): string => {
  const lines = [
    '🏆 *RANKING DA SEMANA — Turma Transformação*',
    '',
  ];

  members.slice(0, 5).forEach((m, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    lines.push(`${medal} *${m.name}* — ${m.streak} dias streak | ${m.xp} XP`);
  });

  lines.push('', '💚 Parabéns a todos — cada dia conta!');
  return lines.join('\n');
};

type RankingMember = { name: string; streak: number; xp: number };

// ============================================================
// CRIAR GRUPO DE DESAFIO
// ============================================================
export async function createChallengeGroup(params: {
  consultantId: string;
  name: string;
  description?: string;
  challengeDays?: number;
  whatsappGroupLink?: string;
}): Promise<string> {
  const startDate = new Date().toISOString().split('T')[0];

  const { data, error } = await db.client
    .from('challenge_groups')
    .insert({
      consultant_id: params.consultantId,
      name: params.name,
      description: params.description ?? '',
      challenge_days: params.challengeDays ?? 21,
      start_date: startDate,
      whatsapp_group_link: params.whatsappGroupLink ?? null,
      max_members: 15,
      status: 'active',
    })
    .select('id')
    .single();

  if (error || !data) throw new Error(`Erro ao criar grupo: ${error?.message}`);

  const groupId = (data as { id: string }).id;
  logger.info(`Grupo de desafio criado: ${params.name} (${groupId})`);
  return groupId;
}

// ============================================================
// ADICIONAR MEMBRO AO GRUPO
// ============================================================
export async function addMemberToGroup(
  groupId: string,
  projectId: string
): Promise<void> {
  await db.client.from('group_members').insert({
    group_id: groupId,
    project_id: projectId,
  });
  logger.info(`Membro adicionado ao grupo ${groupId}`);
}

// ============================================================
// ENVIAR MENSAGEM PARA TODOS OS MEMBROS DO GRUPO
// ============================================================
export async function broadcastToGroup(
  groupId: string,
  message: string
): Promise<number> {
  type MemberRow = {
    project_id: string;
    client_projects: {
      leads: { phone: string | null; full_name: string | null };
    };
  };

  const { data: members } = await db.client
    .from('group_members')
    .select(`
      project_id,
      client_projects!inner(
        leads!inner(phone, full_name)
      )
    `)
    .eq('group_id', groupId);

  if (!members?.length) return 0;

  let sent = 0;
  for (const member of (members as unknown) as MemberRow[]) {
    const lead = member.client_projects?.leads;
    if (!lead?.phone) continue;

    const phone = lead.phone;
    enqueueSend(phone, async () => {
      await sendText(phone, message);
    });
    sent++;
  }

  logger.info(`Broadcast enviado para ${sent} membros do grupo ${groupId}`);
  return sent;
}

// ============================================================
// MENSAGEM DE BOM DIA DO MODERADOR
// ============================================================
export async function sendMorningMessage(groupId: string, day: number): Promise<void> {
  const template = MORNING_MESSAGES[day % MORNING_MESSAGES.length];
  const message = template.replace('${day}', String(day));
  await broadcastToGroup(groupId, message);
}

// ============================================================
// MENSAGEM DE BOA NOITE DO MODERADOR
// ============================================================
export async function sendEveningMessage(groupId: string, day: number): Promise<void> {
  const template = EVENING_MESSAGES[day % EVENING_MESSAGES.length];
  const message = template.replace('${day}', String(day));
  await broadcastToGroup(groupId, message);
}

// ============================================================
// GERAR E ENVIAR RANKING SEMANAL
// ============================================================
export async function sendWeeklyRanking(groupId: string): Promise<void> {
  type MemberRow = {
    project_id: string;
    client_projects: {
      leads: { full_name: string | null };
      client_gamification: Array<{ current_streak: number; xp_total: number }>;
    };
  };

  const { data: members } = await db.client
    .from('group_members')
    .select(`
      project_id,
      client_projects!inner(
        leads!inner(full_name),
        client_gamification(current_streak, xp_total)
      )
    `)
    .eq('group_id', groupId);

  if (!members?.length) return;

  const ranking: RankingMember[] = (members as unknown as MemberRow[])
    .map(m => {
      const gam = m.client_projects?.client_gamification?.[0];
      const name = m.client_projects?.leads?.full_name?.split(' ')[0] ?? 'Membro';
      return {
        name,
        streak: gam?.current_streak ?? 0,
        xp: gam?.xp_total ?? 0,
      };
    })
    .sort((a, b) => b.xp - a.xp);

  const message = RANKING_TEMPLATE(ranking);
  await broadcastToGroup(groupId, message);
  logger.info(`Ranking semanal enviado para grupo ${groupId}`);
}

// ============================================================
// CELEBRAR MILESTONE DE UM MEMBRO
// ============================================================
export async function celebrateMilestone(params: {
  groupId: string;
  memberName: string;
  day: number;
  type: 'streak' | 'badge' | 'weight';
}): Promise<void> {
  const template = CELEBRATION_MESSAGES[Math.floor(Math.random() * CELEBRATION_MESSAGES.length)];
  const message = template
    .replace('${name}', params.memberName.split(' ')[0])
    .replace('${day}', String(params.day));

  await broadcastToGroup(params.groupId, message);
}

// ============================================================
// SCHEDULER: PROCESSAR TODOS OS GRUPOS ATIVOS
// ============================================================
export async function processActiveGroups(): Promise<void> {
  const { data: groups } = await db.client
    .from('challenge_groups')
    .select('id, name, start_date, challenge_days')
    .eq('status', 'active');

  if (!groups?.length) return;

  const now = new Date();
  const isEvening = now.getHours() >= 20;
  const isMorning = now.getHours() === 8;
  const isMonday = now.getDay() === 1;

  type GroupRow = { id: string; name: string; start_date: string; challenge_days: number };

  for (const group of (groups as unknown) as GroupRow[]) {
    const startDate = new Date(group.start_date);
    const day = Math.floor((now.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;

    // Encerrar grupos que passaram do prazo
    if (day > group.challenge_days) {
      await db.client
        .from('challenge_groups')
        .update({ status: 'completed' })
        .eq('id', group.id);

      await broadcastToGroup(group.id,
        `🏆 *DESAFIO CONCLUÍDO!*\n\nParabéns a todos que participaram do *${group.name}*!\nVocês fizeram história. Resultados incríveis! 🌟`
      );
      continue;
    }

    if (isMorning) await sendMorningMessage(group.id, day);
    if (isEvening) await sendEveningMessage(group.id, day);
    if (isMonday && isMorning) await sendWeeklyRanking(group.id);
  }
}
