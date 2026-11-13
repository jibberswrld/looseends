-- LooseEnds schema. Idempotent: safe to run repeatedly (pnpm db:migrate).

create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  publik_handle text unique,
  timezone text,
  own_key_enc text,
  own_base_url text,
  own_model text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_active_day date
);

create table if not exists sessions (
  id text primary key, -- sha256(cookie value)
  user_id uuid references users(id) on delete cascade,
  install_id uuid not null,
  telemetry_id uuid not null,
  os text not null default 'linux',
  publik_key_enc text,
  publik_base_url text,
  claim_url text,
  claim_state text not null default 'anonymous',
  wallet_checked_at timestamptz,
  ai_choice text,
  last_app_opened_at timestamptz,
  last_active_session_at timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists sessions_user_idx on sessions(user_id);

create table if not exists sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null,
  title text not null,
  content text not null,
  content_hash text not null,
  classification text not null default 'obligations',
  summary text,
  injection_detected boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists sources_user_idx on sources(user_id);
create index if not exists sources_user_hash_idx on sources(user_id, content_hash);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  source_id uuid references sources(id) on delete cascade,
  title text not null,
  next_step_type text not null default 'other',
  next_step text not null default '',
  evidence_quote text,
  evidence_start int,
  evidence_end int,
  due_at timestamptz,
  due_all_day boolean not null default false,
  due_status text not null default 'none',
  due_text text,
  due_note text,
  priority text not null default 'normal',
  confidence real not null default 1,
  status text not null default 'detected',
  snoozed_until timestamptz,
  recipient text,
  duplicate_of uuid references tasks(id) on delete set null,
  is_promotional boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists tasks_user_idx on tasks(user_id);
create index if not exists tasks_user_status_idx on tasks(user_id, status);
create index if not exists tasks_source_idx on tasks(source_id);

create table if not exists actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  kind text not null,
  payload jsonb not null,
  status text not null default 'prepared',
  receipts jsonb not null default '[]'::jsonb,
  error text,
  remind_at timestamptz,
  fired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists actions_task_idx on actions(task_id);
create index if not exists actions_due_reminders_idx on actions(user_id, remind_at) where kind = 'reminder' and fired_at is null;

create table if not exists events (
  id bigserial primary key,
  user_id uuid references users(id) on delete cascade,
  session_id text,
  name text not null,
  props jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists events_name_time_idx on events(name, created_at);
