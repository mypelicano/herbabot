/**
 * Script de Migration — PELÍCANO™ v3.0
 *
 * Executa o schema.sql completo no Supabase via Management API.
 * Uso: npm run db:migrate
 *
 * Requer variáveis de ambiente:
 *   SUPABASE_URL          — URL do projeto Supabase
 *   SUPABASE_SERVICE_KEY  — Service role key
 *   SUPABASE_MGMT_TOKEN   — Management API token (sbp_...)
 */

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(__dirname, 'schema.sql');

const SUPABASE_URL = process.env['SUPABASE_URL'] ?? '';
const MGMT_TOKEN = process.env['SUPABASE_MGMT_TOKEN'] ?? '';

// Extrai o ref do projeto da URL (ex: oxscrjstwjhxgyeyjeyf)
const PROJECT_REF = SUPABASE_URL.split('//')[1]?.split('.')[0] ?? '';

if (!PROJECT_REF || !MGMT_TOKEN) {
  console.error('❌ Defina SUPABASE_URL e SUPABASE_MGMT_TOKEN no .env');
  process.exit(1);
}

const sql = readFileSync(schemaPath, 'utf-8');

console.log(`📦 Executando migration no projeto: ${PROJECT_REF}`);
console.log(`📄 Schema: ${schemaPath}`);

const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${MGMT_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query: sql }),
});

if (res.status === 200 || res.status === 201) {
  console.log('✅ Migration executada com sucesso!');
} else {
  const body = await res.text();
  console.error(`❌ Falha na migration (${res.status}):`, body);
  process.exit(1);
}
