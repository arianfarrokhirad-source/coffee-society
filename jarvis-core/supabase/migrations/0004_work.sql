-- =====================================================================
-- 0004 — Objectives, projects, tasks, task dependencies, decisions,
--        approvals and notifications.
-- =====================================================================

create table if not exists public.objectives (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  business_id     uuid references public.businesses(id) on delete cascade,
  title           text not null check (char_length(title) between 1 and 300),
  description     text,
  status          public.objective_status not null default 'draft',
  priority        public.priority_level not null default 'P2',
  target_date     date,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists objectives_org_idx on public.objectives(organization_id);
create index if not exists objectives_business_idx on public.objectives(business_id);
create index if not exists objectives_status_idx on public.objectives(status);

create table if not exists public.projects (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  business_id     uuid not null references public.businesses(id) on delete cascade,
  objective_id    uuid references public.objectives(id) on delete set null,
  name            text not null check (char_length(name) between 1 and 300),
  description     text,
  status          public.project_status not null default 'planning',
  priority        public.priority_level not null default 'P2',
  start_date      date,
  due_date        date,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists projects_org_idx on public.projects(organization_id);
create index if not exists projects_business_idx on public.projects(business_id);
create index if not exists projects_status_idx on public.projects(status);

create table if not exists public.tasks (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  business_id     uuid not null references public.businesses(id) on delete cascade,
  project_id      uuid references public.projects(id) on delete set null,
  objective_id    uuid references public.objectives(id) on delete set null,
  title           text not null check (char_length(title) between 1 and 300),
  description     text,
  status          public.task_status not null default 'todo',
  priority        public.priority_level not null default 'P2',
  due_date        date,
  assigned_to     uuid references public.profiles(id) on delete set null,
  assigned_agent_id uuid references public.agents(id) on delete set null,
  created_by      uuid references public.profiles(id) on delete set null,
  created_by_agent_id uuid references public.agents(id) on delete set null,
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists tasks_org_idx on public.tasks(organization_id);
create index if not exists tasks_business_idx on public.tasks(business_id);
create index if not exists tasks_project_idx on public.tasks(project_id);
create index if not exists tasks_status_idx on public.tasks(status);
create index if not exists tasks_due_idx on public.tasks(due_date) where status not in ('done', 'cancelled');

create table if not exists public.task_dependencies (
  task_id         uuid not null references public.tasks(id) on delete cascade,
  depends_on_id   uuid not null references public.tasks(id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (task_id, depends_on_id),
  check (task_id <> depends_on_id)
);

create table if not exists public.decisions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  business_id     uuid references public.businesses(id) on delete cascade,
  title           text not null check (char_length(title) between 1 and 300),
  context         text,
  decision        text not null,
  rationale       text,
  status          public.decision_status not null default 'recorded',
  decided_by      uuid references public.profiles(id) on delete set null,
  recorded_by_agent_id uuid references public.agents(id) on delete set null,
  decided_at      timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists decisions_org_idx on public.decisions(organization_id);
create index if not exists decisions_business_idx on public.decisions(business_id);

create table if not exists public.approvals (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  business_id           uuid references public.businesses(id) on delete cascade,
  requested_by_agent_id uuid references public.agents(id) on delete set null,
  requested_by_user_id  uuid references public.profiles(id) on delete set null,
  action_type           text not null check (char_length(action_type) between 2 and 120),
  action_payload        jsonb not null default '{}',
  reason                text,
  estimated_cost        numeric(14, 2),
  currency              text check (currency ~ '^[A-Z]{3}$'),
  risk_level            public.risk_level not null default 'medium',
  status                public.approval_status not null default 'pending',
  approved_by           uuid references public.profiles(id) on delete set null,
  approved_at           timestamptz,
  executed_at           timestamptz,
  expires_at            timestamptz,
  execution_result      jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (requested_by_agent_id is not null or requested_by_user_id is not null)
);

create index if not exists approvals_org_idx on public.approvals(organization_id);
create index if not exists approvals_business_idx on public.approvals(business_id);
create index if not exists approvals_status_idx on public.approvals(status);
create index if not exists approvals_pending_idx on public.approvals(created_at desc) where status = 'pending';

create table if not exists public.notifications (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  business_id     uuid references public.businesses(id) on delete cascade,
  recipient_id    uuid references public.profiles(id) on delete cascade,
  priority        public.priority_level not null default 'P2',
  title           text not null check (char_length(title) between 1 and 300),
  body            text,
  resource_type   text,
  resource_id     uuid,
  status          text not null default 'unread' check (status in ('unread', 'read', 'archived')),
  read_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists notifications_recipient_idx
  on public.notifications(recipient_id, status, created_at desc);

drop trigger if exists objectives_updated_at on public.objectives;
create trigger objectives_updated_at before update on public.objectives
  for each row execute function public.set_updated_at();
drop trigger if exists projects_updated_at on public.projects;
create trigger projects_updated_at before update on public.projects
  for each row execute function public.set_updated_at();
drop trigger if exists tasks_updated_at on public.tasks;
create trigger tasks_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();
drop trigger if exists decisions_updated_at on public.decisions;
create trigger decisions_updated_at before update on public.decisions
  for each row execute function public.set_updated_at();
drop trigger if exists approvals_updated_at on public.approvals;
create trigger approvals_updated_at before update on public.approvals
  for each row execute function public.set_updated_at();
drop trigger if exists notifications_updated_at on public.notifications;
create trigger notifications_updated_at before update on public.notifications
  for each row execute function public.set_updated_at();
