-- =====================================================================
-- 0008 — FORGE (A01) pilot domain: leads, clients, website audits,
--        proposals, website projects, maintenance plans.
-- Minimal internal records only. No outbound email in Phase 1.
-- Future workflow: lead → audit → diagnosis → proposal → approval
--                  → client → project → deployment → maintenance.
-- =====================================================================

create table if not exists public.leads (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  business_id     uuid not null references public.businesses(id) on delete cascade,
  company_name    text not null check (char_length(company_name) between 1 and 200),
  contact_name    text,
  contact_email   text,
  contact_phone   text,
  website_url     text,
  source          text,
  status          text not null default 'new'
    check (status in ('new', 'contacted', 'qualified', 'audit_scheduled', 'proposal_sent', 'won', 'lost', 'archived')),
  notes           text,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists leads_business_idx on public.leads(business_id, status);

create table if not exists public.clients (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  business_id     uuid not null references public.businesses(id) on delete cascade,
  lead_id         uuid references public.leads(id) on delete set null,
  company_name    text not null check (char_length(company_name) between 1 and 200),
  contact_name    text,
  contact_email   text,
  status          text not null default 'active' check (status in ('active', 'paused', 'churned')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists clients_business_idx on public.clients(business_id, status);

create table if not exists public.website_audits (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  business_id     uuid not null references public.businesses(id) on delete cascade,
  lead_id         uuid references public.leads(id) on delete cascade,
  website_url     text,
  findings        jsonb not null default '{}',
  score           integer check (score is null or (score between 0 and 100)),
  status          text not null default 'draft' check (status in ('draft', 'completed')),
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.proposals (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  business_id     uuid not null references public.businesses(id) on delete cascade,
  lead_id         uuid references public.leads(id) on delete cascade,
  audit_id        uuid references public.website_audits(id) on delete set null,
  title           text not null check (char_length(title) between 1 and 300),
  summary         text,
  line_items      jsonb not null default '[]',
  total_amount    numeric(14, 2) check (total_amount is null or total_amount >= 0),
  currency        text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  status          text not null default 'draft'
    check (status in ('draft', 'pending_approval', 'approved', 'sent', 'accepted', 'declined', 'expired')),
  approval_id     uuid references public.approvals(id) on delete set null,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists proposals_business_idx on public.proposals(business_id, status);

create table if not exists public.website_projects (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  business_id     uuid not null references public.businesses(id) on delete cascade,
  client_id       uuid references public.clients(id) on delete cascade,
  proposal_id     uuid references public.proposals(id) on delete set null,
  project_id      uuid references public.projects(id) on delete set null,
  name            text not null check (char_length(name) between 1 and 300),
  status          text not null default 'planning'
    check (status in ('planning', 'design', 'build', 'review', 'deployed', 'closed')),
  deployed_url    text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.maintenance_plans (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  business_id        uuid not null references public.businesses(id) on delete cascade,
  client_id          uuid references public.clients(id) on delete cascade,
  website_project_id uuid references public.website_projects(id) on delete set null,
  name               text not null,
  monthly_amount     numeric(14, 2) check (monthly_amount is null or monthly_amount >= 0),
  currency           text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  status             text not null default 'active' check (status in ('active', 'paused', 'cancelled')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- RLS: same business-scoped model as core tables. Contact details in
-- leads/clients are internal data — the has_business_access() helper
-- already excludes the 'client' role.
alter table public.leads             enable row level security;
alter table public.clients           enable row level security;
alter table public.website_audits    enable row level security;
alter table public.proposals         enable row level security;
alter table public.website_projects  enable row level security;
alter table public.maintenance_plans enable row level security;

do $$
declare t text;
begin
  foreach t in array array['leads', 'clients', 'website_audits', 'proposals', 'website_projects', 'maintenance_plans']
  loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format(
      'create policy %I_select on public.%I for select using (public.has_business_access(business_id))', t, t);
    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format(
      'create policy %I_insert on public.%I for insert with check (public.has_business_access(business_id))', t, t);
    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format(
      'create policy %I_update on public.%I for update using (public.has_business_access(business_id)) with check (public.has_business_access(business_id))', t, t);
    execute format('drop policy if exists %I_delete on public.%I', t, t);
    execute format(
      'create policy %I_delete on public.%I for delete using (public.is_prime(organization_id))', t, t);
  end loop;
end $$;

drop trigger if exists leads_updated_at on public.leads;
create trigger leads_updated_at before update on public.leads
  for each row execute function public.set_updated_at();
drop trigger if exists clients_updated_at on public.clients;
create trigger clients_updated_at before update on public.clients
  for each row execute function public.set_updated_at();
drop trigger if exists website_audits_updated_at on public.website_audits;
create trigger website_audits_updated_at before update on public.website_audits
  for each row execute function public.set_updated_at();
drop trigger if exists proposals_updated_at on public.proposals;
create trigger proposals_updated_at before update on public.proposals
  for each row execute function public.set_updated_at();
drop trigger if exists website_projects_updated_at on public.website_projects;
create trigger website_projects_updated_at before update on public.website_projects
  for each row execute function public.set_updated_at();
drop trigger if exists maintenance_plans_updated_at on public.maintenance_plans;
create trigger maintenance_plans_updated_at before update on public.maintenance_plans
  for each row execute function public.set_updated_at();
