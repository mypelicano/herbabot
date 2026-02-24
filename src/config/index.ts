import 'dotenv/config';
import { z } from 'zod';

// Schema de validação das variáveis de ambiente
const envSchema = z.object({
  ANTHROPIC_API_KEY: z.string().default(''),
  SUPABASE_URL: z.string().default('http://localhost:54321'),
  SUPABASE_SERVICE_KEY: z.string().default(''),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().optional(),
  INSTAGRAM_VERIFY_TOKEN: z.string().default('pelicano_verify_token'),
  DASHBOARD_API_KEY: z.string().optional(),
  REDIS_URL: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  AUDIO_TRIGGER_DELAY_MS: z.coerce.number().default(120000),
  TIMEZONE_OFFSET: z.coerce.number().default(-3),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  MAX_MESSAGES_PER_HOUR: z.coerce.number().default(30),
  MIN_DELAY_MS: z.coerce.number().default(2000),
  MAX_DELAY_MS: z.coerce.number().default(6000),
  PORT: z.coerce.number().default(3000),
});

const parsed = envSchema.safeParse(process.env);
// Garante que parsed.success sempre é true (valores têm defaults)
if (!parsed.success) throw new Error('Erro interno de configuração');

export const env = parsed.data;

// Verifica se o ambiente está totalmente configurado (para uso em runtime)
export const isConfigured = {
  anthropic: !!env.ANTHROPIC_API_KEY,
  supabase: !!env.SUPABASE_SERVICE_KEY && env.SUPABASE_URL !== 'http://localhost:54321',
  elevenlabs: !!env.ELEVENLABS_API_KEY,
};

export const config = {
  anthropic: {
    apiKey: env.ANTHROPIC_API_KEY,
    model: 'claude-opus-4-6' as const,
    maxTokens: 1024,
  },
  supabase: {
    url: env.SUPABASE_URL,
    serviceKey: env.SUPABASE_SERVICE_KEY,
  },
  elevenlabs: {
    apiKey: env.ELEVENLABS_API_KEY,
    voiceId: env.ELEVENLABS_VOICE_ID,
  },
  instagram: {
    verifyToken: env.INSTAGRAM_VERIFY_TOKEN,
  },
  dashboard: {
    apiKey: env.DASHBOARD_API_KEY,
  },
  audio: {
    triggerDelayMs: env.AUDIO_TRIGGER_DELAY_MS,
  },
  safety: {
    maxMessagesPerHour: env.MAX_MESSAGES_PER_HOUR,
    minDelayMs: env.MIN_DELAY_MS,
    maxDelayMs: env.MAX_DELAY_MS,
    timezoneOffset: env.TIMEZONE_OFFSET,
  },
  app: {
    isDev: env.NODE_ENV === 'development',
    isProd: env.NODE_ENV === 'production',
    logLevel: env.LOG_LEVEL,
    port: env.PORT,
  },
} as const;
