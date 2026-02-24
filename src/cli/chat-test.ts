/**
 * CLI de Teste Interativo do PELÍCANO™
 * Simula uma conversa completa para validar o motor de conversação
 *
 * Como usar:
 *   npm run test:chat
 */

import * as readline from 'readline';
import chalk from 'chalk';
import { v4 as uuidv4 } from 'uuid';
import { processMessage, initiateConversation } from '../engine/conversation.js';
import { scoreIntent } from '../engine/intent-scorer.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('CLI');

// ============================================================
// IDs FAKE PARA TESTE (sem banco de dados)
// ============================================================
const MOCK_LEAD_ID = uuidv4();
const MOCK_CONSULTANT_ID = uuidv4();
const MOCK_CHANNEL = 'cli_test';

// ============================================================
// MODO DE TESTE SEM BANCO (mock do banco)
// ============================================================
// Quando NODE_ENV=test, o conversation.ts usa mock local
// Para teste real com banco: configure o .env

// ============================================================
// INTERFACE DE LINHA DE COMANDO
// ============================================================
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

function printHeader(): void {
  console.clear();
  console.log(chalk.bold.cyan('╔══════════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║           🦅  PELÍCANO™ v3.0 — Teste de Chat            ║'));
  console.log(chalk.bold.cyan('║        Agente Autônomo de Conversão Herbalife            ║'));
  console.log(chalk.bold.cyan('╚══════════════════════════════════════════════════════════╝'));
  console.log();
}

function printMessage(role: 'assistant' | 'user', content: string, stage?: string): void {
  if (role === 'assistant') {
    console.log(chalk.cyan('┌─ 🦅 PELÍCANO') + (stage ? chalk.dim(` [${stage}]`) : ''));
    console.log(chalk.cyan('│  ') + chalk.white(content));
    console.log(chalk.cyan('└─────────────────'));
    console.log();
  } else {
    console.log(chalk.green('┌─ 👤 VOCÊ'));
    console.log(chalk.green('│  ') + chalk.white(content));
    console.log(chalk.green('└─────────────────'));
    console.log();
  }
}

function printScore(text: string): void {
  const score = scoreIntent(text);
  console.log(chalk.dim('─── Score de Intenção ───'));
  console.log(chalk.dim(`  Produto:  ${score.productScore}/100  ${getScoreBar(score.productScore)}`));
  console.log(chalk.dim(`  Negócio:  ${score.businessScore}/100  ${getScoreBar(score.businessScore)}`));
  console.log(chalk.dim(`  Urgência: ${score.urgencyScore}/100  ${getScoreBar(score.urgencyScore)}`));
  console.log(chalk.dim(`  Perfil: ${score.primaryProfile} | Prioridade: ${score.priority}`));
  console.log(chalk.dim('─────────────────────────'));
  console.log();
}

function getScoreBar(score: number): string {
  const filled = Math.round(score / 10);
  const empty = 10 - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  if (score >= 70) return chalk.green(bar);
  if (score >= 40) return chalk.yellow(bar);
  return chalk.gray(bar);
}

async function selectProfile(): Promise<{
  type: 'product' | 'business';
  name: string;
  context: string;
}> {
  console.log(chalk.yellow('Selecione o perfil do lead para simular:'));
  console.log('  1. Produto (emagrecimento/energia/saúde)');
  console.log('  2. Negócio (renda extra/empreendedorismo)');
  console.log();

  const choice = await prompt('Escolha (1 ou 2): ');
  const name = await prompt('Nome do lead (ou Enter para anônimo): ');
  const sourceContext = await prompt('Contexto do primeiro contato (o que ela postou/fez): ');

  console.log();

  return {
    type: choice === '2' ? 'business' : 'product',
    name: name || 'Lead',
    context: sourceContext || 'demonstrou interesse em saúde no Instagram',
  };
}

// ============================================================
// MODO OFFLINE: Simula respostas sem API (para testar a estrutura)
// ============================================================
async function runOfflineMode(): Promise<void> {
  console.log(chalk.yellow('⚡ Modo OFFLINE — Demonstração da estrutura de fluxo SPIN'));
  console.log();

  const stages = [
    {
      stage: 'ice_break',
      assistant: 'Vi que você falou bastante sobre energia natural! Que legal. O que você já testou que realmente funcionou pra você em termos de energia?',
      user: 'Oi! Já tentei várias coisas mas nada me dá energia de verdade. Tomo café mas parece que não resolve mais...',
    },
    {
      stage: 'situation',
      assistant: 'Entendo! É frustrante quando você depende de algo e ele para de funcionar. Como está sua rotina hoje — você tem horários irregulares, trabalha muito, acorda cedo?',
      user: 'Sim, acordo às 6h e fico no trabalho até as 18h. Quando chego em casa não tenho energia pra nada, nem pra academia.',
    },
    {
      stage: 'problem',
      assistant: 'Caramba, isso é puxado mesmo. E o que mais te frustra nisso? O cansaço em si ou o fato de não conseguir fazer as coisas que você quer depois do trabalho?',
      user: 'Ah, os dois. Mas o que me mata é que sinto que não consigo mais fazer o que gostava — treinar, sair com as amigas...',
    },
    {
      stage: 'implication',
      assistant: 'Faz sentido. E quando você fica sem energia assim, você sente que isso afeta sua disposição emocional também? Tipo, fica mais irritada, ansiosa?',
      user: 'Muito! Às vezes nem quero socializar de tanto que estou cansada. Meu marido reclama também rsrs',
    },
    {
      stage: 'commitment',
      assistant: 'Entendi tudo. Você não é preguiçosa, você está esgotada — e isso tem solução. Se eu te mostrasse algo simples que muita gente aqui usa pra recuperar energia de verdade em 2-3 semanas, você avaliaria?',
      user: 'Com certeza! O que é?',
    },
    {
      stage: 'transition',
      assistant: 'Que ótimo! Fica mais fácil eu te explicar direitinho e mandar um material feito pra você pelo WhatsApp. Você tem? Me passa seu número ou te mando o meu.',
      user: 'Claro, meu número é (11) 99999-0000',
    },
  ];

  for (const step of stages) {
    printMessage('assistant', step.assistant, step.stage);
    await new Promise(r => setTimeout(r, 800));
    printMessage('user', step.user);
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(chalk.bold.green('✅ Fluxo SPIN completo demonstrado!'));
  console.log(chalk.dim('Configure o .env com suas chaves de API para usar o modo real com IA.'));
}

// ============================================================
// MODO ONLINE: Usa a API Claude real
// ============================================================
async function runOnlineMode(): Promise<void> {
  const profile = await selectProfile();

  console.log(chalk.bold('Iniciando conversa...'));
  console.log(chalk.dim('(Digite "sair" para encerrar, "score <texto>" para analisar um texto)'));
  console.log();

  try {
    // Iniciar com o quebra-gelo do PELÍCANO
    const firstMessage = await initiateConversation({
      leadId: MOCK_LEAD_ID,
      consultantId: MOCK_CONSULTANT_ID,
      channel: MOCK_CHANNEL,
      sourceContext: profile.context,
      leadName: profile.name,
      profileType: profile.type,
    });

    printMessage('assistant', firstMessage, 'ice_break');

    // Loop de conversa
    while (true) {
      const userInput = await prompt(chalk.green('Você: '));
      console.log();

      if (userInput.toLowerCase() === 'sair') {
        console.log(chalk.yellow('Conversa encerrada.'));
        break;
      }

      if (userInput.toLowerCase().startsWith('score ')) {
        const textToScore = userInput.substring(6);
        printScore(textToScore);
        continue;
      }

      printMessage('user', userInput);

      try {
        console.log(chalk.dim('PELÍCANO está digitando...'));

        const result = await processMessage({
          leadId: MOCK_LEAD_ID,
          consultantId: MOCK_CONSULTANT_ID,
          channel: MOCK_CHANNEL,
          userMessage: userInput,
        });

        // Delay artificial para parecer humano
        const delay = Math.random() * 2000 + 1500;
        await new Promise(r => setTimeout(r, delay));

        // Limpar o "digitando..."
        process.stdout.moveCursor?.(0, -1);
        process.stdout.clearLine?.(0);

        printMessage('assistant', result.reply, result.spinStage);

        if (result.handoffTriggered) {
          console.log(chalk.bold.yellow('⚡ HANDOFF ATIVADO — Lead qualificado para o consultor humano!'));
          console.log();
        }

        if (result.nextAction === 'request_whatsapp') {
          console.log(chalk.bold.green('📱 Transição para WhatsApp iniciada!'));
          console.log();
        }

      } catch (error) {
        const err = error as Error;
        if (err.message.includes('API key')) {
          console.log(chalk.red('❌ Chave de API inválida ou não configurada.'));
          console.log(chalk.dim('Configure ANTHROPIC_API_KEY no arquivo .env'));
        } else {
          logger.error('Erro ao processar mensagem', error);
        }
      }
    }
  } catch (error) {
    const err = error as Error;
    if (err.message.includes('supabase') || err.message.includes('database')) {
      console.log(chalk.yellow('⚠️  Banco de dados não configurado. Alternando para modo offline...'));
      console.log();
      await runOfflineMode();
    } else {
      throw error;
    }
  }
}

// ============================================================
// PONTO DE ENTRADA
// ============================================================
async function main(): Promise<void> {
  printHeader();

  const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
  const hasSupabase = !!process.env.SUPABASE_URL;

  if (!hasApiKey || !hasSupabase) {
    console.log(chalk.yellow('⚠️  Ambiente não configurado completamente.'));
    console.log(chalk.dim('  ANTHROPIC_API_KEY: ' + (hasApiKey ? chalk.green('✓') : chalk.red('✗ não configurada'))));
    console.log(chalk.dim('  SUPABASE_URL:      ' + (hasSupabase ? chalk.green('✓') : chalk.red('✗ não configurada'))));
    console.log();
    console.log(chalk.dim('Rodando em modo DEMO (sem API real)...'));
    console.log();

    await runOfflineMode();
  } else {
    await runOnlineMode();
  }

  rl.close();
}

main().catch((error) => {
  logger.error('Erro fatal na CLI', error);
  process.exit(1);
});
