-- =====================================================================
-- 0003 — AI agent definitions and per-agent permissions.
-- Agents never inherit user permissions; their capabilities are the
-- rows in these tables, enforced server-side.
-- =====================================================================

create table if not exists public.agents (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references public.organizations(id) on delete cascade,
  business_id             uuid references public.businesses(id) on delete cascade,
  code                    text not null check (code ~ '^[A-Z0-9]{2,4}-[A-Z0-9]{2,4}$'),
  name                    text not null,
  description             text,
  authority_level         public.authority_level not null default 'L1',
  allowed_action_types    text[] not null default '{}',
  prohibited_action_types text[] not null default '{}',
  max_financial_authority numeric(14, 2) not null default 0 check (max_financial_authority >= 0),
  currency                text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  prompt_version          text not null default 'v1',
  active                  boolean not null default true,
  status                  text not null default 'active' check (status in ('active', 'inactive', 'retired')),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (organization_id, code)
);

create index if not exists agents_business_idx on public.agents(business_id);

create table if not exists public.agent_permissions (
  agent_id      uuid not null references public.agents(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  granted_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  primary key (agent_id, permission_id)
);

drop trigger if exists agents_updated_at on public.agents;
create trigger agents_updated_at before update on public.agents
  for each row execute function public.set_updated_at();
