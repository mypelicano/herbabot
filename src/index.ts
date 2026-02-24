/**
 * PELÍCANO™ v3.0
 * Agente Autônomo de Conversão e Prospecção Multicanal
 */

import * as Sentry from '@sentry/node';
import { logger } from './lib/logger.js';
import { startServer } from './server.js';

// Inicializar Sentry antes de qualquer outra coisa
const SENTRY_DSN = process.env.SENTRY_DSN;
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'production',
    tracesSampleRate: 0.1, // 10% das transações rastreadas (evita cota)
    beforeSend(event) {
      // Não enviar erros de desenvolvimento local
      if (process.env.NODE_ENV === 'development') return null;
      return event;
    },
  });
  logger.info('Sentry inicializado ✅');
}

async function bootstrap(): Promise<void> {
  logger.info('🦅 PELÍCANO™ v3.0 iniciando...');
  logger.info('');
  logger.info('✅ Módulos ativos:');
  logger.info('   Motor de Conversação SPIN (Claude API)');
  logger.info('   Score Tridimensional de Intenção');
  logger.info('   Memória de Contexto por Lead');
  logger.info('   Canal WhatsApp (Evolution API)');
  logger.info('   Safety: rate limiting + anti-ban');
  logger.info('   Régua 7 dias (follow-up)');
  logger.info('   Régua 30 dias (pós-compra)');
  logger.info('   Scheduler de mensagens automáticas');
  logger.info('');
  logger.info('🔄 Em desenvolvimento:');
  logger.info('   Fase 3: Gamificação e Projetos de Cliente');
  logger.info('   Fase 4: Monitor de Redes Sociais');
  logger.info('   Fase 5: Dashboard do Consultor');
  logger.info('');

  startServer();
}

// Capturar exceções não tratadas e enviar ao Sentry
process.on('uncaughtException', (error) => {
  logger.error('Exceção não tratada', error);
  if (SENTRY_DSN) Sentry.captureException(error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Promise rejeitada sem handler', reason);
  if (SENTRY_DSN) Sentry.captureException(reason);
});

bootstrap().catch((error) => {
  logger.error('Erro fatal na inicialização', error);
  if (SENTRY_DSN) Sentry.captureException(error);
  process.exit(1);
});
