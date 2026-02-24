-- ============================================================
-- PELÍCANO™ v3.0 — Schema do Banco de Dados (Supabase/PostgreSQL)
-- ============================================================

-- Habilitar UUID
create extension if not exists "uuid-ossp";

-- ============================================================
-- CONSULTORES (cada um é uma instância do PELÍCANO)
-- ============================================================
create table if not exists consultants (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,
  phone         text unique not null,       -- número WhatsApp com DDI
  instagram     text,
  instagram_page_id text,                        -- ID da página Facebook/Instagram para webhook
  plan_tier     text not null default 'starter', -- starter | pro | team
  whatsapp_connected boolean default false,
  config        jsonb default '{}'::jsonb,  -- configurações personalizadas
  active        boolean default true,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- ============================================================
-- LEADS (prospectos capturados)
-- ============================================================
create table if not exists leads (
  id                  uuid primary key default uuid_generate_v4(),
  consultant_id       uuid not null references consultants(id) on delete cascade,
  platform            text not null,        -- instagram | facebook | whatsapp | manual
  username            text,                 -- @handle na rede social
  full_name           text,
  phone               text,                 -- número WhatsApp quando disponível
  source_context      text,                 -- texto do post/story que gerou o lead
  profile_url         text,
  first_contact_at    timestamptz default now(),
  last_activity_at    timestamptz default now(),
  created_at          timestamptz default now()
);

-- ============================================================
-- SCORES DE QUALIFICAÇÃO
-- ============================================================
create table if not exists lead_scores (
  id              uuid primary key default uuid_generate_v4(),
  lead_id         uuid not null references leads(id) on delete cascade,
  product_score   int not null default 0 check (product_score between 0 and 100),
  business_score  int not null default 0 check (business_score between 0 and 100),
  urgency_score   int not null default 0 check (urgency_score between 0 and 100),
  total_score     int generated always as (
                    (product_score + business_score + urgency_score) / 3
                  ) stored,
  -- Estágio no funil
  stage           text not null default 'detected',
                  -- detected → contacted → whatsapp → negotiating → converted → lost
  stage_updated_at timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ============================================================
-- CONVERSAS (histórico completo)
-- ============================================================
create table if not exists conversations (
  id              uuid primary key default uuid_generate_v4(),
  lead_id         uuid not null references leads(id) on delete cascade,
  consultant_id   uuid not null references consultants(id) on delete cascade,
  channel         text not null,            -- instagram_dm | whatsapp | facebook_dm
  -- Etapa SPIN atual
  spin_stage      text not null default 'ice_break',
                  -- ice_break → situation → problem → implication → commitment → transition → closed
  messages        jsonb default '[]'::jsonb, -- array de {role, content, timestamp}
  context_data    jsonb default '{}'::jsonb, -- dados coletados: dor, objetivo, situação
  handoff_triggered boolean default false,
  status          text not null default 'active', -- active | paused | converted | lost
  started_at      timestamptz default now(),
  converted_at    timestamptz,
  updated_at      timestamptz default now()
);

-- ============================================================
-- CLIENTES (leads convertidos com projeto ativo)
-- ============================================================
create table if not exists client_projects (
  id                  uuid primary key default uuid_generate_v4(),
  lead_id             uuid not null references leads(id),
  consultant_id       uuid not null references consultants(id),
  product_kit         text not null,             -- nome do kit comprado
  goal_description    text not null,             -- ex: "Perder 6kg em 60 dias"
  goal_type           text not null default 'weight_loss',
                      -- weight_loss | energy | performance | business
  start_weight_kg     numeric(5,2),
  current_weight_kg   numeric(5,2),
  target_weight_kg    numeric(5,2),
  start_date          date not null default current_date,
  target_date         date,
  status              text not null default 'active', -- active | paused | completed | abandoned
  notes               text,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

-- ============================================================
-- GAMIFICAÇÃO (por projeto de cliente)
-- ============================================================
create table if not exists client_gamification (
  id                    uuid primary key default uuid_generate_v4(),
  project_id            uuid not null references client_projects(id) on delete cascade,
  xp_total              int not null default 0,
  level                 int not null default 1,
  current_streak        int not null default 0,
  max_streak            int not null default 0,
  checkin_count_total   int not null default 0,
  checkin_count_30d     int not null default 0,
  last_checkin_at       timestamptz,
  badges                jsonb default '[]'::jsonb, -- array de badge codes
  updated_at            timestamptz default now()
);

-- ============================================================
-- CHECK-INS DIÁRIOS
-- ============================================================
create table if not exists daily_checkins (
  id            uuid primary key default uuid_generate_v4(),
  project_id    uuid not null references client_projects(id) on delete cascade,
  checkin_date  date not null default current_date,
  shake_am      boolean default false,
  shake_pm      boolean default false,
  hydration_ok  boolean default false,
  supplement_ok boolean default false,
  weight_kg     numeric(5,2),
  mood          int check (mood between 1 and 5), -- 1-5 como se sentiu
  notes         text,
  xp_earned     int not null default 0,
  created_at    timestamptz default now(),
  unique(project_id, checkin_date)
);

-- ============================================================
-- GRUPOS / DESAFIOS
-- ============================================================
create table if not exists challenge_groups (
  id                  uuid primary key default uuid_generate_v4(),
  consultant_id       uuid not null references consultants(id),
  name                text not null,
  description         text,
  challenge_days      int not null default 21,
  start_date          date not null,
  end_date            date generated always as (start_date + challenge_days) stored,
  whatsapp_group_link text,
  max_members         int default 15,
  status              text not null default 'active', -- active | completed | cancelled
  created_at          timestamptz default now()
);

create table if not exists group_members (
  group_id    uuid not null references challenge_groups(id) on delete cascade,
  project_id  uuid not null references client_projects(id) on delete cascade,
  joined_at   timestamptz default now(),
  primary key (group_id, project_id)
);

-- ============================================================
-- MÉTRICAS DIÁRIAS (agregadas por consultor)
-- ============================================================
create table if not exists daily_metrics (
  id                    uuid primary key default uuid_generate_v4(),
  date                  date not null default current_date,
  consultant_id         uuid not null references consultants(id),
  leads_detected        int default 0,
  leads_contacted       int default 0,
  leads_to_whatsapp     int default 0,
  conversions_product   int default 0,
  conversions_business  int default 0,
  reorders              int default 0,
  handoffs              int default 0,
  unique(date, consultant_id)
);

-- ============================================================
-- ÍNDICES PARA PERFORMANCE
-- ============================================================
create index if not exists idx_leads_consultant on leads(consultant_id);
create index if not exists idx_leads_phone on leads(phone) where phone is not null;
create index if not exists idx_conversations_lead on conversations(lead_id);
create index if not exists idx_conversations_status on conversations(status);
create index if not exists idx_lead_scores_lead on lead_scores(lead_id);
create index if not exists idx_lead_scores_stage on lead_scores(stage);
create index if not exists idx_lead_scores_total on lead_scores(total_score desc);
create index if not exists idx_client_projects_consultant on client_projects(consultant_id);
create index if not exists idx_client_projects_status on client_projects(status);
create index if not exists idx_daily_checkins_project on daily_checkins(project_id);
create index if not exists idx_daily_checkins_date on daily_checkins(checkin_date);
create index if not exists idx_daily_metrics_consultant_date on daily_metrics(consultant_id, date desc);

-- ============================================================
-- FUNÇÃO: Atualizar updated_at automaticamente
-- ============================================================
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_consultants_updated_at before update on consultants
  for each row execute function update_updated_at();

create trigger trg_conversations_updated_at before update on conversations
  for each row execute function update_updated_at();

create trigger trg_client_projects_updated_at before update on client_projects
  for each row execute function update_updated_at();

create trigger trg_gamification_updated_at before update on client_gamification
  for each row execute function update_updated_at();
