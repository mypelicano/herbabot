# 🦅 PELÍCANO™ v3.0

> Agente autônomo de conversão e retenção para consultoras Herbalife.

## Arquitetura

```
HUNTER (prospecção)  →  CONVERTER (SPIN AI)  →  KEEPER (gamificação)
Instagram/ManyChat       Claude claude-opus-4-6       Check-ins diários
Monitor de keywords      6 etapas SPIN                XP + Badges + Streaks
Score de intenção        Handoff automático            Grupos de desafio
Fila de prospects        Sequências de follow-up       Gatilho recompra dia 25
```

## Stack

- **Runtime**: Node.js 22 + TypeScript ESM
- **IA**: Claude claude-opus-4-6 (Anthropic)
- **Banco**: Supabase (PostgreSQL)
- **WhatsApp**: Evolution API (Baileys)
- **Áudio**: ElevenLabs TTS
- **Monitor**: Instagram Graph API + ManyChat

## Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/health` | Status do servidor |
| `POST` | `/webhook/whatsapp` | Webhook Evolution API |
| `GET/POST` | `/webhook/instagram` | Webhook Instagram |
| `POST` | `/webhook/manychat` | Webhook ManyChat |
| `GET` | `/api/dashboard/:id/summary` | Resumo do consultor |
| `GET` | `/api/dashboard/:id/prospects` | Fila de prospects |
| `POST` | `/api/dashboard/:id/approach-prospect` | Iniciar abordagem |
| `GET` | `/api/dashboard/:id/metrics?days=30` | Métricas históricas |
| `GET` | `/api/dashboard/:id/daily-report` | Relatório do dia |

## Setup Rápido

```bash
# 1. Instalar dependências
npm install

# 2. Configurar ambiente
cp .env.example .env
# Editar .env com suas chaves

# 3. Rodar schema no Supabase
# Copie o conteúdo de src/database/schema.sql
# e execute no Supabase SQL Editor

# 4. Build e rodar
npm run build
npm start

# 5. Teste conversacional (CLI)
npm run chat
```

## Variáveis de Ambiente

| Variável | Descrição | Obrigatória |
|----------|-----------|-------------|
| `ANTHROPIC_API_KEY` | Chave da API Claude | Sim |
| `SUPABASE_URL` | URL do projeto Supabase | Sim |
| `SUPABASE_SERVICE_KEY` | Service role key | Sim |
| `EVOLUTION_API_URL` | URL da instância Evolution | Sim |
| `EVOLUTION_API_KEY` | Chave da Evolution API | Sim |
| `ELEVENLABS_API_KEY` | Chave ElevenLabs (áudio) | Opcional |
| `INSTAGRAM_VERIFY_TOKEN` | Token webhook Instagram | Opcional |
| `DASHBOARD_API_KEY` | Chave API dashboard | Opcional |

## Cron Jobs

| Horário | Ação |
|---------|------|
| 07:00 | Relatório diário para consultores |
| 08:00 | Check-ins + grupos + follow-up leads |
| 11:00 | Régua pós-compra + gatilho recompra |
| 14:00 | Notificações de prospects quentes |
| 20:00 | Mensagens noturnas nos grupos |

## Deploy no Render

1. Conecte este repositório no [render.com](https://render.com)
2. Selecione "Web Service"
3. Adicione as variáveis de ambiente
4. Deploy automático a cada push

---

*PELÍCANO™ — A máquina de vendas que trabalha enquanto você dorme.* 🦅
# Build ter, 24 de fev de 2026 01:54:00
