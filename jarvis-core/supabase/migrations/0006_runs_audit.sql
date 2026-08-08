-- =====================================================================
-- 0006 — Agent runs, agent messages, tool calls, model usage,
--        audit logs, daily briefs and system events.
-- =====================================================================

create table if not exists public.agent_runs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  business_id     uuid references public.businesses(id) on delete cascade,
  agent_id        uuid references public.agents(id) on delete set null,
  requested_by    uuid references public.profiles(id) on delete set null,
  request_id      text,
  intent          text,
  provider        text check (provider in ('anthropic', 'openai', 'none')),
  model           text,
  status          public.agent_run_status not null default 'pending',
  input_summary   text,
  output_summary  text,
  rationale       text, -- concise decision rationale only; never chain-of-thought
  error           text,
  approval_id     uuid references public.approvals(id) on delete set null,
  started_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists agent_runs_org_idx on public.agent_runs(organization_id, created_at desc);
create index if not exists agent_runs_agent_idx on public.agent_runs(agent_id);
create index if not exists agent_runs_status_idx on public.agent_runs(status);

create table if not exists public.agent_messages (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid not null references public.agent_runs(id) on delete cascade,
  seq          integer not null check (seq >= 0),
  role         text not null check (role in ('system', 'user', 'assistant', 'tool')),
  content      text not null,
  created_at   timestamptz not null default now(),
  unique (run_id, seq)
);

create table if not exists public.tool_calls (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  run_id          uuid references public.agent_runs(id) on delete cascade,
  business_id     uuid references public.businesses(id) on delete cascade,
  tool_name       text not null,
  arguments       jsonb not null default '{}',
  status          public.tool_call_status not null default 'requested',
  denial_reason   text,
  result_summary  text,
  error           text,
  duration_ms     integer check (duration_ms is null or duration_ms >= 0),
  created_at      timestamptz not null default now()
);

create index if not exists tool_calls_run_idx on public.tool_calls(run_id);
create index if not exists tool_calls_org_idx on public.tool_calls(organization_id, created_at desc);

create table if not exists public.model_usage (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  run_id          uuid references public.agent_runs(id) on delete set null,
  provider        text not null check (provider in ('anthropic', 'openai')),
  model           text not null,
  input_tokens    integer check (input_tokens is null or input_tokens >= 0),
  output_tokens   integer check (output_tokens is null or output_tokens >= 0),
  latency_ms      integer check (latency_ms is null or latency_ms >= 0),
  success         boolean not null default true,
  created_at      timestamptz not null default now()
);

create index if not exists model_usage_org_idx on public.model_usage(organization_id, created_at desc);

create table if not exists public.audit_logs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  business_id     uuid,
  actor_type      public.actor_type not null,
  actor_id        uuid,
  action          text not null check (char_length(action) between 2 and 120),
  resource_type   text,
  resource_id     uuid,
  request_id      text,
  before_data     jsonb,
  after_data      jsonb,
  metadata        jsonb, -- IP / user agent / request metadata where available
  created_at      timestamptz not null default now()
);

create index if not exists audit_logs_org_idx on public.audit_logs(organization_id, created_at desc);
create index if not exists audit_logs_actor_idx on public.audit_logs(actor_type, actor_id);
create index if not exists audit_logs_resource_idx on public.audit_logs(resource_type, resource_id);

-- Tamper resistance: audit logs are append-only at the database level.
-- The trigger fires for every role, including service_role (RLS bypass does
-- not bypass triggers). Retention pruning requires deliberately dropping
-- the trigger inside a migration — an auditable act in itself.
create or replace function public.audit_logs_block_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_logs is append-only';
end;
$$;

drop trigger if exists audit_logs_no_update on public.audit_logs;
create trigger audit_logs_no_update before update on public.audit_logs
  for each row execute function public.audit_logs_block_mutation();
drop trigger if exists audit_logs_no_delete on public.audit_logs;
create trigger audit_logs_no_delete before delete on public.audit_logs
  for each row execute function public.audit_logs_block_mutation();

create table if not exists public.daily_briefs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  brief_date      date not null,
  content         jsonb not null, -- structured sections: money, threats, opportunities, approvals, todays_priority, system_health
  generated_by    uuid references public.profiles(id) on delete set null,
  status          text not null default 'generated' check (status in ('generated', 'failed')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, brief_date)
);

create table if not exists public.system_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  business_id     uuid references public.businesses(id) on delete cascade,
  event_type      text not null check (char_length(event_type) between 2 and 120),
  payload         jsonb not null default '{}',
  dedupe_key      text, -- idempotency: same key is processed at most once
  status          public.event_status not null default 'pending',
  attempts        integer not null default 0 check (attempts >= 0),
  last_error      text,
  processed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists system_events_dedupe_idx
  on public.system_events(organization_id, event_type, dedupe_key)
  where dedupe_key is not null;
create index if not exists system_events_status_idx on public.system_events(status, created_at);

drop trigger if exists agent_runs_updated_at on public.agent_runs;
create trigger agent_runs_updated_at before update on public.agent_runs
  for each row execute function public.set_updated_at();
drop trigger if exists daily_briefs_updated_at on public.daily_briefs;
create trigger daily_briefs_updated_at before update on public.daily_briefs
  for each row execute function public.set_updated_at();
drop trigger if exists system_events_updated_at on public.system_events;
create trigger system_events_updated_at before update on public.system_events
  for each row execute function public.set_updated_at();
