/**
 * Rotas da API do Dashboard
 *
 * Endpoints REST para o painel do consultor.
 * Autenticação simples por Bearer token (JWT do Supabase em produção).
 *
 * Rotas:
 *   GET  /api/dashboard/:consultantId/summary
 *   GET  /api/dashboard/:consultantId/clients
 *   GET  /api/dashboard/:consultantId/prospects
 *   GET  /api/dashboard/:consultantId/metrics?days=30
 *   POST /api/dashboard/:consultantId/approach-prospect
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '../lib/logger.js';

// Cliente Supabase para verificar JWT Bearer do frontend
const supabaseAdmin = createSupabaseClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_KEY ?? '',
);

const ApproachProspectSchema = z.object({
  prospectId: z.string().min(1),
  prospectPhone: z.string().min(10),
  prospectName: z.string().optional(),
});
import { config } from '../config/index.js';
import {
  getDashboardSummary,
  getHistoricalMetrics,
  buildDailyReportMessage,
} from './metrics.js';
import {
  getNextProspects,
  approachProspect,
} from '../monitor/prospect-queue.js';
import { generateProjectReport } from '../engine/gamification.js';

const logger = createLogger('DASHBOARD-API');
const router = Router();

// ============================================================
// MIDDLEWARE DE AUTENTICAÇÃO DUAL
// Aceita: X-API-Key (server-to-server) OU Bearer JWT (frontend)
// ============================================================
async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const expectedKey = config.dashboard.apiKey;

  // 1. Verificar X-API-Key (modo server-to-server)
  const apiKey = req.headers['x-api-key'] as string | undefined;
  if (!expectedKey || (apiKey && apiKey === expectedKey)) {
    next();
    return;
  }

  // 2. Verificar Bearer JWT do Supabase (frontend)
  const bearer = (req.headers['authorization'] as string | undefined)?.replace('Bearer ', '');
  if (bearer && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    try {
      const { data: { user } } = await supabaseAdmin.auth.getUser(bearer);
      if (user) {
        (req as Request & { supabaseUser?: unknown }).supabaseUser = user;
        next();
        return;
      }
    } catch {
      // JWT inválido — continua para retornar 401
    }
  }

  res.status(401).json({ error: 'Não autorizado' });
}

router.use(authMiddleware);

// helper para extrair parâmetro de rota sempre como string
const p = (req: Request, key: string): string => req.params[key] as string;

// ============================================================
// GET /api/dashboard/:consultantId/summary
// Resumo completo do consultor
// ============================================================
router.get('/:consultantId/summary', async (req: Request, res: Response) => {
  try {
    const summary = await getDashboardSummary(p(req, 'consultantId'));
    res.json(summary);
  } catch (error) {
    logger.error('Erro ao gerar summary', error);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ============================================================
// GET /api/dashboard/:consultantId/prospects
// Lista prospects na fila com prioridade
// ============================================================
router.get('/:consultantId/prospects', async (req: Request, res: Response) => {
  try {
    const consultantId = p(req, 'consultantId');
    const limit = parseInt((req.query['limit'] as string | undefined) ?? '20', 10);
    const prospects = await getNextProspects(consultantId, limit);
    res.json({ prospects, total: prospects.length });
  } catch (error) {
    logger.error('Erro ao buscar prospects', error);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ============================================================
// POST /api/dashboard/:consultantId/approach-prospect
// Iniciar abordagem de prospect pelo consultor
// ============================================================
router.post('/:consultantId/approach-prospect', async (req: Request, res: Response) => {
  try {
    const consultantId = p(req, 'consultantId');

    const parsed = ApproachProspectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten().fieldErrors });
      return;
    }
    const { prospectId, prospectPhone, prospectName } = parsed.data;

    const success = await approachProspect({
      consultantId,
      prospectId,
      prospectPhone,
      prospectName,
    });

    res.json({ success });
  } catch (error) {
    logger.error('Erro ao iniciar abordagem', error);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ============================================================
// GET /api/dashboard/:consultantId/metrics
// Métricas históricas (últimos N dias)
// ============================================================
router.get('/:consultantId/metrics', async (req: Request, res: Response) => {
  try {
    const consultantId = p(req, 'consultantId');
    const days = parseInt((req.query['days'] as string | undefined) ?? '30', 10);
    const metrics = await getHistoricalMetrics(consultantId, days);
    res.json({ metrics, days });
  } catch (error) {
    logger.error('Erro ao buscar métricas históricas', error);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ============================================================
// GET /api/dashboard/project/:projectId/report
// Relatório completo de um cliente específico
// ============================================================
router.get('/project/:projectId/report', async (req: Request, res: Response) => {
  try {
    const projectId = p(req, 'projectId');
    const report = await generateProjectReport(projectId);
    res.json({ projectId, report });
  } catch (error) {
    logger.error('Erro ao gerar relatório do projeto', error);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ============================================================
// GET /api/dashboard/:consultantId/daily-report
// Gerar e retornar o relatório diário (texto WhatsApp)
// ============================================================
router.get('/:consultantId/daily-report', async (req: Request, res: Response) => {
  try {
    const consultantId = p(req, 'consultantId');
    const message = await buildDailyReportMessage(consultantId);
    res.json({ consultantId, message });
  } catch (error) {
    logger.error('Erro ao gerar relatório diário', error);
    res.status(500).json({ error: 'Erro interno' });
  }
});

export { router as dashboardRouter };
