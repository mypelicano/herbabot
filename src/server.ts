/**
 * Servidor HTTP — Webhook da Evolution API + Instagram + roteador de canais
 */

import crypto from 'node:crypto';
import * as Sentry from '@sentry/node';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createLogger } from './lib/logger.js';
import {
  handleWebhookEvent,
  type EvolutionWebhookPayload,
} from './channels/whatsapp-handler.js';
import { startScheduler } from './pipeline/scheduler.js';
import {
  handleInstagramWebhook,
  handleManyChatWebhook,
  verifyInstagramWebhook,
  type InstagramWebhookPayload,
  type ManyChatWebhookPayload,
} from './monitor/instagram-webhook.js';
import { dashboardRouter } from './dashboard/api-routes.js';
import { config } from './config/index.js';

const logger = createLogger('SERVER');
const app = express();

app.use(express.json({ limit: '5mb' }));

// ============================================================
// DASHBOARD API
// ============================================================
app.use('/api/dashboard', dashboardRouter);

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'PELICANO v3.0', ts: new Date().toISOString() });
});

// ============================================================
// WEBHOOK — EVOLUTION API (WhatsApp)
// Cada instância pode enviar para o mesmo endpoint,
// diferenciando pelo header X-Instance-Phone
// ============================================================

// Validação HMAC: verifica apikey enviada pela Evolution API no header
function validateEvolutionHmac(req: express.Request): boolean {
  const expectedKey = process.env.EVOLUTION_API_KEY ?? '';
  if (!expectedKey) return true; // sem chave configurada, aceita (modo dev)

  const sentKey = (req.headers['apikey'] as string | undefined) ?? '';
  // Comparação em tempo constante para evitar timing attacks
  if (sentKey.length !== expectedKey.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sentKey), Buffer.from(expectedKey));
}

app.post('/webhook/whatsapp', async (req, res) => {
  // Validar autenticidade da requisição antes de qualquer processamento
  if (!validateEvolutionHmac(req)) {
    logger.warn('Webhook WhatsApp rejeitado: apikey inválida');
    res.sendStatus(401);
    return;
  }

  // Responder imediatamente para não timeout na Evolution API
  res.sendStatus(200);

  const payload = req.body as EvolutionWebhookPayload;
  // O número do consultor (instância) vem no header ou no body
  const instancePhone =
    (req.headers['x-instance-phone'] as string) ??
    payload.instance ??
    process.env.EVOLUTION_INSTANCE_PHONE ??
    '';

  if (!instancePhone) {
    logger.warn('Webhook recebido sem identificação de instância');
    return;
  }

  try {
    await handleWebhookEvent(payload, instancePhone);
  } catch (error) {
    logger.error('Erro ao processar webhook WhatsApp', error);
  }
});

// ============================================================
// WEBHOOK — INSTAGRAM GRAPH API (comentários, DMs, mentions)
// Verificação: GET /webhook/instagram
// Eventos:     POST /webhook/instagram
// ============================================================
app.get('/webhook/instagram', (req, res) => {
  const challenge = verifyInstagramWebhook({
    mode: req.query['hub.mode'] as string,
    token: req.query['hub.verify_token'] as string,
    challenge: req.query['hub.challenge'] as string,
    verifyToken: config.instagram.verifyToken,
  });

  if (challenge) {
    res.send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook/instagram', async (req, res) => {
  res.sendStatus(200);

  try {
    await handleInstagramWebhook(req.body as InstagramWebhookPayload);
  } catch (error) {
    logger.error('Erro ao processar webhook Instagram', error);
  }
});

// ============================================================
// WEBHOOK — MANYCHAT
// POST /webhook/manychat?consultant_id=...
// ============================================================
app.post('/webhook/manychat', async (req, res) => {
  res.sendStatus(200);

  const consultantId = req.query['consultant_id'] as string;
  if (!consultantId) {
    logger.warn('ManyChat webhook recebido sem consultant_id');
    return;
  }

  try {
    await handleManyChatWebhook(req.body as ManyChatWebhookPayload, consultantId);
  } catch (error) {
    logger.error('Erro ao processar webhook ManyChat', error);
  }
});

// ============================================================
// ERROR HANDLER GLOBAL — captura erros Express e envia ao Sentry
// Deve ser o ÚLTIMO middleware registrado
// ============================================================
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Erro Express não tratado', err);
  if (process.env.SENTRY_DSN) Sentry.captureException(err);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

// ============================================================
// INICIAR SERVIDOR
// ============================================================
const PORT = config.app.port;

export function startServer(): void {
  app.listen(PORT, () => {
    logger.info(`🦅 PELÍCANO™ servidor rodando na porta ${PORT}`);
    logger.info(`   Webhook WA:  http://localhost:${PORT}/webhook/whatsapp`);
    logger.info(`   Webhook IG:  http://localhost:${PORT}/webhook/instagram`);
    logger.info(`   Webhook MC:  http://localhost:${PORT}/webhook/manychat`);
    logger.info(`   Health:      http://localhost:${PORT}/health`);
  });

  // Iniciar scheduler de réguas
  startScheduler();
}

export { app };
