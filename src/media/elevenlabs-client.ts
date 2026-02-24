/**
 * Cliente ElevenLabs — Geração de Áudio Personalizado
 *
 * O PELÍCANO pode enviar mensagens de voz personalizadas
 * com nome e contexto do lead — criando uma conexão muito mais
 * humana e aumentando a taxa de resposta em até 3x.
 *
 * Configuração:
 * - ELEVENLABS_API_KEY: chave da API
 * - ELEVENLABS_VOICE_ID: ID da voz da consultora (clonada ou pré-definida)
 */

import { createLogger } from '../lib/logger.js';
import { config } from '../config/index.js';

const logger = createLogger('ELEVENLABS');

const BASE_URL = 'https://api.elevenlabs.io/v1';

// ============================================================
// VOZES DISPONÍVEIS (IDs padrão do ElevenLabs)
// O consultor pode clonar a própria voz para autenticidade máxima
// ============================================================
export const VOICE_PRESETS = {
  RACHEL: '21m00Tcm4TlvDq8ikWAM',   // Feminino, calorosa
  DOMI:   'AZnzlk1XvdvUeBnXmlld',   // Feminino, energia alta
  BELLA:  'EXAVITQu4vr4xnSDxMaL',   // Feminino, suave
  ELLI:   'MF3mGyEYCl7XYWbV9V6O',   // Feminino, jovial
  ARNOLD: 'VR6AewLTigWG4xSOukaG',   // Masculino, autoridade
} as const;

// ============================================================
// CONFIGURAÇÕES DE VOZ
// ============================================================
const DEFAULT_VOICE_SETTINGS = {
  stability: 0.75,
  similarity_boost: 0.85,
  style: 0.3,
  use_speaker_boost: true,
};

// ============================================================
// GERAR ÁUDIO A PARTIR DE TEXTO
// Retorna o buffer de áudio MP3
// ============================================================
export async function generateAudio(params: {
  text: string;
  voiceId?: string;
  modelId?: string;
}): Promise<Buffer> {
  const apiKey = config.elevenlabs.apiKey;
  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY não configurada');
  }

  const voiceId = params.voiceId ?? config.elevenlabs.voiceId ?? VOICE_PRESETS.RACHEL;
  const modelId = params.modelId ?? 'eleven_multilingual_v2';

  logger.debug(`Gerando áudio: "${params.text.substring(0, 50)}..." (voz: ${voiceId})`);

  const response = await fetch(
    `${BASE_URL}/text-to-speech/${voiceId}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text: params.text,
        model_id: modelId,
        voice_settings: DEFAULT_VOICE_SETTINGS,
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`ElevenLabs API erro ${response.status}: ${errText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  logger.debug(`Áudio gerado: ${arrayBuffer.byteLength} bytes`);
  return Buffer.from(arrayBuffer);
}

// ============================================================
// LISTAR VOZES DISPONÍVEIS NA CONTA
// ============================================================
export async function listVoices(): Promise<Array<{ voice_id: string; name: string; category: string }>> {
  const apiKey = config.elevenlabs.apiKey;
  if (!apiKey) return [];

  const response = await fetch(`${BASE_URL}/voices`, {
    headers: { 'xi-api-key': apiKey },
  });

  if (!response.ok) return [];

  const data = await response.json() as { voices: Array<{ voice_id: string; name: string; category: string }> };
  return data.voices ?? [];
}

// ============================================================
// VERIFICAR QUOTA RESTANTE
// ============================================================
export async function getQuotaInfo(): Promise<{
  character_count: number;
  character_limit: number;
  remaining: number;
} | null> {
  const apiKey = config.elevenlabs.apiKey;
  if (!apiKey) return null;

  const response = await fetch(`${BASE_URL}/user/subscription`, {
    headers: { 'xi-api-key': apiKey },
  });

  if (!response.ok) return null;

  const data = await response.json() as {
    character_count: number;
    character_limit: number;
  };

  return {
    character_count: data.character_count,
    character_limit: data.character_limit,
    remaining: data.character_limit - data.character_count,
  };
}
