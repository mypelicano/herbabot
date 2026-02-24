import chalk from 'chalk';
import { config } from '../config/index.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const COLORS: Record<LogLevel, (text: string) => string> = {
  debug: chalk.gray,
  info: chalk.cyan,
  warn: chalk.yellow,
  error: chalk.red,
};

const ICONS: Record<LogLevel, string> = {
  debug: '🔍',
  info: '💬',
  warn: '⚠️ ',
  error: '❌',
};

function formatTimestamp(): string {
  return new Date().toISOString().replace('T', ' ').substring(0, 23);
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[config.app.logLevel as LogLevel];
}

function log(level: LogLevel, module: string, message: string, data?: unknown): void {
  if (!shouldLog(level)) return;

  const timestamp = chalk.dim(formatTimestamp());
  const icon = ICONS[level];
  const coloredLevel = COLORS[level](level.toUpperCase().padEnd(5));
  const coloredModule = chalk.magenta(`[${module}]`);
  const formattedMessage = COLORS[level](message);

  let output = `${timestamp} ${icon} ${coloredLevel} ${coloredModule} ${formattedMessage}`;

  if (data !== undefined) {
    const dataStr = typeof data === 'object'
      ? JSON.stringify(data, null, 2)
      : String(data);
    output += `\n${chalk.dim(dataStr)}`;
  }

  if (level === 'error') {
    console.error(output);
  } else {
    console.log(output);
  }
}

// Factory de logger por módulo
export function createLogger(module: string) {
  return {
    debug: (message: string, data?: unknown) => log('debug', module, message, data),
    info: (message: string, data?: unknown) => log('info', module, message, data),
    warn: (message: string, data?: unknown) => log('warn', module, message, data),
    error: (message: string, data?: unknown) => log('error', module, message, data),
  };
}

// Logger padrão do sistema
export const logger = createLogger('PELICANO');
