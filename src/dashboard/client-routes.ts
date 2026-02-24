/**
 * Rotas da API do Cliente (área do cliente web)
 *
 * Autenticação: Bearer JWT do Supabase (auth_user_id → client_users → project_id)
 * Alternativa: user_metadata.project_id no token JWT
 *
 * Rotas:
 *   GET  /api/client/me          — dados do projeto + gamificação
 *   POST /api/client/checkin     — submeter check-in
 *   GET  /api/client/badges      — badges conquistados + disponíveis
 *   GET  /api/client/history     — histórico de peso e XP
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { createLogger } from '../lib/logger.js';
import { processCheckin, generateProjectReportJSON } from '../engine/gamification.js';

const logger = createLogger('CLIENT-API');
const router = Router();

// Cliente Supabase admin para verificar JWT e buscar dados
const supabase = createSupabaseClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_KEY ?? '',
);

const CheckinSchema = z.object({
  shakeAm:       z.boolean().default(false),
  shakePm:       z.boolean().default(false),
  hydrationOk:   z.boolean().default(false),
  supplementOk:  z.boolean().default(false),
  weightKg:      z.number().optional(),
  mood:          z.number().min(1).max(5).optional(),
});

// Middleware: obter project_id a partir do Bearer JWT
async function withProjectId(req: Request, res: Response): Promise<string | null> {
  const bearer = (req.headers['authorization'] as string | undefined)?.replace('Bearer ', '');
  if (!bearer) {
    res.status(401).json({ error: 'Token não fornecido' });
    return null;
  }

  const { data: { user } } = await supabase.auth.getUser(bearer);
  if (!user) {
    res.status(401).json({ error: 'Token inválido' });
    return null;
  }

  // 1. Tentar client_users table (caminho preferido)
  const { data: clientUser } = await supabase
    .from('client_users')
    .select('project_id')
    .eq('auth_user_id', user.id)
    .single();

  if (clientUser?.project_id) return clientUser.project_id as string;

  // 2. Fallback: user_metadata.project_id (para contas criadas manualmente)
  const projectId = user.user_metadata?.project_id as string | undefined;
  if (projectId) return projectId;

  res.status(403).json({ error: 'Conta não vinculada a nenhum projeto' });
  return null;
}

// ============================================================
// GET /api/client/me
// ============================================================
router.get('/me', async (req: Request, res: Response) => {
  try {
    const projectId = await withProjectId(req, res);
    if (!projectId) return;

    const report = await generateProjectReportJSON(projectId);
    if (!report) {
      res.status(404).json({ error: 'Projeto não encontrado' });
      return;
    }
    res.json({ projectId, report });
  } catch (error) {
    logger.error('Erro ao buscar dados do cliente', error);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ============================================================
// POST /api/client/checkin
// ============================================================
router.post('/checkin', async (req: Request, res: Response) => {
  try {
    const projectId = await withProjectId(req, res);
    if (!projectId) return;

    const parsed = CheckinSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten().fieldErrors });
      return;
    }

    const result = await processCheckin(projectId, parsed.data);
    res.json(result);
  } catch (error) {
    logger.error('Erro ao processar check-in do cliente', error);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ============================================================
// GET /api/client/badges
// ============================================================
router.get('/badges', async (req: Request, res: Response) => {
  try {
    const projectId = await withProjectId(req, res);
    if (!projectId) return;

    const { data: earned } = await supabase
      .from('client_badges')
      .select('badge_id, earned_at')
      .eq('project_id', projectId);

    res.json({ projectId, badges: earned ?? [] });
  } catch (error) {
    logger.error('Erro ao buscar badges', error);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ============================================================
// GET /api/client/history
// ============================================================
router.get('/history', async (req: Request, res: Response) => {
  try {
    const projectId = await withProjectId(req, res);
    if (!projectId) return;

    const [checkinsRes, gamiRes] = await Promise.all([
      supabase
        .from('daily_checkins')
        .select('checkin_date, weight_kg, xp_gained, shake_am, shake_pm, hydration_ok, supplement_ok')
        .eq('project_id', projectId)
        .order('checkin_date', { ascending: false })
        .limit(90),
      supabase
        .from('client_gamification')
        .select('xp_total, level, current_streak, max_streak')
        .eq('project_id', projectId)
        .single(),
    ]);

    res.json({
      projectId,
      checkins: checkinsRes.data ?? [],
      gamification: gamiRes.data ?? null,
    });
  } catch (error) {
    logger.error('Erro ao buscar histórico', error);
    res.status(500).json({ error: 'Erro interno' });
  }
});

export { router as clientRouter };
