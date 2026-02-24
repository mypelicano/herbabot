/**
 * PELÍCANO™ v3.0
 * Agente Autônomo de Conversão e Prospecção Multicanal
 */

import { logger } from './lib/logger.js';
import { startServer } from './server.js';

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

bootstrap().catch((error) => {
  logger.error('Erro fatal na inicialização', error);
  process.exit(1);
});
