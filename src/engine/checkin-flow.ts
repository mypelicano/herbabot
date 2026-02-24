/**
 * Fluxo de Check-in Diário via WhatsApp
 *
 * O PELÍCANO envia uma mensagem estruturada todo dia
 * e processa as respostas do cliente de forma conversacional.
 */

import { createLogger } from '../lib/logger.js';
import { db } from '../database/client.js';
import { sendText } from '../channels/whatsapp-client.js';
import { enqueueSend } from '../safety/rate-limiter.js';
import { processCheckin, type CheckinData } from './gamification.js';

const logger = createLogger('CHECKIN');

// ============================================================
// ESTADO DO CHECKIN (cache de sessão)
// ============================================================
type CheckinSession = {
  projectId: string;
  leadPhone: string;
  step: 'waiting_shake_am' | 'waiting_shake_pm' | 'waiting_hydration' | 'waiting_supplement' | 'waiting_weight' | 'done';
  data: Partial<CheckinData>;
  startedAt: Date;
};

const activeSessions = new Map<string, CheckinSession>(); // key: leadPhone

// ============================================================
// ENVIAR CHECK-IN DIÁRIO PROATIVO
// ============================================================
export async function sendDailyCheckin(params: {
  projectId: string;
  leadPhone: string;
  leadName?: string;
  dayNumber: number;
  currentStreak: number;
}): Promise<void> {
  const firstName = params.leadName?.split(' ')[0] ?? 'você';
  const streakEmoji = params.currentStreak >= 14 ? '🔥🔥' : params.currentStreak >= 7 ? '🔥' : '⭐';

  const message = [
    `${streakEmoji} *Check-in do Dia ${params.dayNumber}, ${firstName}!*`,
    ``,
    `Streak atual: *${params.currentStreak} dias* 💪`,
    ``,
    `Vamos registrar seu dia?`,
    ``,
    `*Você tomou o shake da MANHÃ hoje?*`,
    `Responda: *SIM* ou *NÃO*`,
  ].join('\n');

  // Iniciar sessão de check-in
  activeSessions.set(params.leadPhone, {
    projectId: params.projectId,
    leadPhone: params.leadPhone,
    step: 'waiting_shake_am',
    data: {},
    startedAt: new Date(),
  });

  enqueueSend(params.leadPhone, async () => {
    await sendText(params.leadPhone, message);
  });

  logger.info(`Check-in diário enviado para ${params.leadPhone.substring(0, 6)}... (dia ${params.dayNumber})`);
}

// ============================================================
// PROCESSAR RESPOSTA DO CHECK-IN
// Chamado pelo handler do WhatsApp quando existe sessão ativa
// ============================================================
export async function handleCheckinResponse(
  phone: string,
  message: string
): Promise<{ handled: boolean; reply?: string }> {
  const session = activeSessions.get(phone);
  if (!session) return { handled: false };

  // Sessão expirada (mais de 2 horas)
  if (Date.now() - session.startedAt.getTime() > 2 * 60 * 60 * 1000) {
    activeSessions.delete(phone);
    return { handled: false };
  }

  const text = message.toLowerCase().trim();
  const isYes = ['sim', 's', 'yes', '✅', '1', 'ok', 'claro', 'tomei', 'fiz', 'tomado'].some(t => text.includes(t));
  const isNo  = ['não', 'nao', 'n', 'no', '❌', '0', 'não tomei', 'esqueci', 'não fiz'].some(t => text.includes(t));

  if (!isYes && !isNo && session.step !== 'waiting_weight') {
    return {
      handled: true,
      reply: 'Não entendi 😅 Responde com *SIM* ou *NÃO*, tá bom?',
    };
  }

  switch (session.step) {
    case 'waiting_shake_am': {
      session.data.shakeAm = isYes;
      session.step = 'waiting_shake_pm';
      return {
        handled: true,
        reply: `${isYes ? '✅ Ótimo!' : '❌ Tudo bem, amanhã!'}\n\n*Tomou o shake da NOITE/TARDE?*\nResponda: *SIM* ou *NÃO*`,
      };
    }

    case 'waiting_shake_pm': {
      session.data.shakePm = isYes;
      session.step = 'waiting_hydration';
      return {
        handled: true,
        reply: `${isYes ? '✅ Perfeito!' : '❌ Ok!'}\n\n*Tomou os 2 litros de água hoje?*\nResponda: *SIM* ou *NÃO*`,
      };
    }

    case 'waiting_hydration': {
      session.data.hydrationOk = isYes;
      session.step = 'waiting_supplement';
      return {
        handled: true,
        reply: `${isYes ? '✅ Hidratação em dia!' : '❌ Fica de olho na água amanhã!'}\n\n*Tomou o suplemento/vitamina hoje?*\nResponda: *SIM* ou *NÃO*`,
      };
    }

    case 'waiting_supplement': {
      session.data.supplementOk = isYes;
      session.step = 'waiting_weight';
      return {
        handled: true,
        reply: `${isYes ? '✅ Arrasou!' : '❌ Não esqueça amanhã!'}\n\n*Quer registrar seu peso hoje? (opcional)*\nSe sim, manda o número (ex: *68.5*)\nSe não, responde *PULAR*`,
      };
    }

    case 'waiting_weight': {
      const isPular = text.includes('pular') || text.includes('skip') || text === 'n' || text === 'não';
      // Regex ancorada: aceita "68", "68.5", "68,5", "68kg" mas NÃO "dia 30" ou frases
      const weightMatch = !isPular && message.trim().match(/^(\d{2,3}([.,]\d{1,2})?)(\s*kg)?$/i);

      if (weightMatch) {
        const weight = parseFloat(weightMatch[1].replace(',', '.'));
        if (weight >= 30 && weight <= 300) { // sanidade fisiológica
          session.data.weightKg = weight;
        }
      }

      session.step = 'done';
      activeSessions.delete(phone);

      // Processar check-in completo
      try {
        const result = await processCheckin(session.projectId, {
          shakeAm: session.data.shakeAm ?? false,
          shakePm: session.data.shakePm ?? false,
          hydrationOk: session.data.hydrationOk ?? false,
          supplementOk: session.data.supplementOk ?? false,
          weightKg: session.data.weightKg,
        });

        return {
          handled: true,
          reply: result.message,
        };
      } catch (error) {
        logger.error('Erro ao processar check-in', error);
        return {
          handled: true,
          reply: 'Check-in registrado! Continue assim 💪',
        };
      }
    }

    default:
      activeSessions.delete(phone);
      return { handled: false };
  }
}

// ============================================================
// VERIFICAR SE LEAD TEM SESSÃO DE CHECK-IN ATIVA
// ============================================================
export function hasActiveCheckinSession(phone: string): boolean {
  const session = activeSessions.get(phone);
  if (!session) return false;
  // Expirar automaticamente sessões antigas
  if (Date.now() - session.startedAt.getTime() > 2 * 60 * 60 * 1000) {
    activeSessions.delete(phone);
    return false;
  }
  return true;
}

// ============================================================
// SCHEDULER: ENVIAR CHECK-INS DIÁRIOS
// Chamado pelo cron às 8h
// ============================================================
export async function dispatchDailyCheckins(): Promise<void> {
  logger.info('Disparando check-ins diários...');

  const { data: activeProjects } = await db.client
    .from('client_projects')
    .select(`
      id,
      start_date,
      leads!inner(phone, full_name),
      client_gamification(current_streak)
    `)
    .eq('status', 'active');

  if (!activeProjects?.length) return;

  type ProjRow = {
    id: string;
    start_date: string;
    leads: { phone: string | null; full_name: string | null };
    client_gamification: Array<{ current_streak: number }>;
  };

  let sent = 0;
  for (const proj of (activeProjects as unknown) as ProjRow[]) {
    const lead = proj.leads;
    if (!lead?.phone) continue;

    const gam = proj.client_gamification?.[0];
    const dayNumber = Math.floor(
      (Date.now() - new Date(proj.start_date).getTime()) / (24 * 60 * 60 * 1000)
    ) + 1;

    await sendDailyCheckin({
      projectId: proj.id,
      leadPhone: lead.phone,
      leadName: lead.full_name ?? undefined,
      dayNumber,
      currentStreak: gam?.current_streak ?? 0,
    });
    sent++;
  }

  logger.info(`${sent} check-ins diários disparados`);
}
