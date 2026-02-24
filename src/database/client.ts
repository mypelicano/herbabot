import { createClient } from '@supabase/supabase-js';
import { config } from '../config/index.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('DATABASE');

// ============================================================
// TIPOS DE DOMÍNIO (usados em toda a aplicação)
// ============================================================

export type ConversationMessage = {
  role: 'assistant' | 'user';
  content: string;
  timestamp: string;
};

export type LeadContextData = {
  pain_points?: string[];
  main_goal?: string;
  current_situation?: string;
  implication?: string;
  commitment_accepted?: boolean;
  profile_type?: 'product' | 'business' | 'both';
  location?: string;
  name?: string;
  source_context?: string;
};

export type Consultant = {
  id: string;
  name: string;
  phone: string;
  instagram: string | null;
  plan_tier: 'starter' | 'pro' | 'team';
  whatsapp_connected: boolean;
  config: Record<string, unknown>;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type Lead = {
  id: string;
  consultant_id: string;
  platform: string;
  username: string | null;
  full_name: string | null;
  phone: string | null;
  source_context: string | null;
  profile_url: string | null;
  first_contact_at: string;
  last_activity_at: string;
  created_at: string;
};

export type Conversation = {
  id: string;
  lead_id: string;
  consultant_id: string;
  channel: string;
  spin_stage: string;
  messages: ConversationMessage[];
  context_data: LeadContextData;
  handoff_triggered: boolean;
  status: string;
  started_at: string;
  converted_at: string | null;
  updated_at: string;
};

export type LeadScore = {
  id: string;
  lead_id: string;
  product_score: number;
  business_score: number;
  urgency_score: number;
  total_score: number;
  stage: string;
  stage_updated_at: string;
  updated_at: string;
};

export type ClientProject = {
  id: string;
  lead_id: string;
  consultant_id: string;
  product_kit: string;
  goal_description: string;
  goal_type: string;
  start_weight_kg: number | null;
  current_weight_kg: number | null;
  target_weight_kg: number | null;
  start_date: string;
  target_date: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ClientGamification = {
  id: string;
  project_id: string;
  xp_total: number;
  level: number;
  current_streak: number;
  max_streak: number;
  checkin_count_total: number;
  checkin_count_30d: number;
  last_checkin_at: string | null;
  badges: string[];
  updated_at: string;
};

// ============================================================
// CLIENTE SUPABASE (sem generics complexos — tipagem manual)
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = ReturnType<typeof createClient<any>>;

let supabaseClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    supabaseClient = createClient(
      config.supabase.url,
      config.supabase.serviceKey,
      { auth: { persistSession: false } }
    );
    logger.info('Cliente Supabase inicializado');
  }
  return supabaseClient;
}

// ============================================================
// HELPERS TIPADOS POR TABELA
// ============================================================

export const db = {
  get client(): SupabaseClient {
    return getSupabaseClient();
  },

  // Conversations
  conversations: {
    async findActive(leadId: string): Promise<Conversation | null> {
      const client = getSupabaseClient();
      const { data } = await client
        .from('conversations')
        .select('*')
        .eq('lead_id', leadId)
        .eq('status', 'active')
        .order('started_at', { ascending: false })
        .limit(1)
        .single();
      return data as Conversation | null;
    },

    async create(payload: {
      lead_id: string;
      consultant_id: string;
      channel: string;
      spin_stage?: string;
      messages?: ConversationMessage[];
      context_data?: Partial<LeadContextData>;
      handoff_triggered?: boolean;
      status?: string;
      converted_at?: string | null;
    }): Promise<Conversation> {
      const client = getSupabaseClient();
      const { data, error } = await client
        .from('conversations')
        .insert(payload)
        .select()
        .single();
      if (error || !data) throw new Error(`Erro ao criar conversa: ${error?.message}`);
      return data as Conversation;
    },

    async update(id: string, payload: {
      spin_stage?: string;
      messages?: ConversationMessage[];
      context_data?: Partial<LeadContextData>;
      status?: string;
      handoff_triggered?: boolean;
      converted_at?: string | null;
    }): Promise<void> {
      const client = getSupabaseClient();
      const { error } = await client
        .from('conversations')
        .update(payload)
        .eq('id', id);
      if (error) throw new Error(`Erro ao atualizar conversa: ${error.message}`);
    },
  },

  // Leads
  leads: {
    async create(payload: Omit<Lead, 'id' | 'first_contact_at' | 'last_activity_at' | 'created_at'>): Promise<Lead> {
      const client = getSupabaseClient();
      const { data, error } = await client.from('leads').insert(payload).select().single();
      if (error || !data) throw new Error(`Erro ao criar lead: ${error?.message}`);
      return data as Lead;
    },

    async findByPhone(phone: string): Promise<Lead | null> {
      const client = getSupabaseClient();
      const { data } = await client.from('leads').select('*').eq('phone', phone).single();
      return data as Lead | null;
    },
  },

  // Lead scores
  leadScores: {
    async upsert(leadId: string, scores: {
      product_score: number;
      business_score: number;
      urgency_score: number;
      stage?: string;
    }): Promise<void> {
      const client = getSupabaseClient();
      await client.from('lead_scores').upsert({
        lead_id: leadId,
        ...scores,
        stage_updated_at: new Date().toISOString(),
      });
    },
  },
};
