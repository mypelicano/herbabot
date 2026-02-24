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
import { createLogger } from '../lib/logger.js';
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
// MIDDLEWARE DE AUTENTICAÇÃO SIMPLES
// Em produção: validar JWT do Supabase
// ============================================================
function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-api-key'] as string | undefined;
  const expectedKey = config.dashboard.apiKey;

  // Se não há chave configurada, aceita tudo (modo dev)
  if (!expectedKey) {
    next();
    return;
  }

  if (!apiKey || apiKey !== expectedKey) {
    res.status(401).json({ error: 'Não autorizado' });
    return;
  }

  next();
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
    const { prospectId, prospectPhone, prospectName } = req.body as {
      prospectId: string;
      prospectPhone: string;
      prospectName?: string;
    };

    if (!prospectId || !prospectPhone) {
      res.status(400).json({ error: 'prospectId e prospectPhone são obrigatórios' });
      return;
    }

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
