-- =====================================================================
-- 0007 — Row Level Security: helper functions, policies, claim_prime.
--
-- Access model:
--   - PRIME (role 'prime', org-wide membership): full org access.
--   - executive: org-wide read/write on operational records.
--   - business_manager / employee / contractor: only businesses they
--     hold an active membership in.
--   - client: NO access to internal tables (no Phase 1 client portal).
--   - agents: never use browser sessions; all agent activity flows
--     through the server with the service role, governed by
--     application-level checks in @jarvis/permissions.
--   - Run/audit/brief/event tables are written only by the server
--     (service role). Authenticated users get read-only, scoped access.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helper functions (security definer so they can read memberships
-- regardless of the caller's own RLS visibility).
-- ---------------------------------------------------------------------

create or replace function public.is_prime(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    join public.roles r on r.id = m.role_id
    where m.profile_id = auth.uid()
      and m.organization_id = p_org
      and m.status = 'active'
      and r.key = 'prime'
  );
$$;

create or replace function public.my_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select distinct m.organization_id
  from public.memberships m
  where m.profile_id = auth.uid()
    and m.status = 'active';
$$;

-- Internal-business access. Excludes the 'client' role by design:
-- clients must never see internal business data.
create or replace function public.has_business_access(p_business uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.businesses b
    join public.memberships m
      on m.organization_id = b.organization_id
     and m.profile_id = auth.uid()
     and m.status = 'active'
    join public.roles r on r.id = m.role_id
    where b.id = p_business
      and r.key <> 'client'
      and (
        r.key in ('prime', 'executive')      -- org-wide roles
        or m.business_id = b.id              -- business-scoped roles
      )
  );
$$;

-- Org-level records (business_id is null): visible to org-wide roles.
create or replace function public.has_org_wide_access(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    join public.roles r on r.id = m.role_id
    where m.profile_id = auth.uid()
      and m.organization_id = p_org
      and m.status = 'active'
      and r.key in ('prime', 'executive')
  );
$$;

-- Row access for tables carrying (organization_id, business_id nullable).
create or replace function public.can_access_scoped(p_org uuid, p_business uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_business is null then public.has_org_wide_access(p_org)
    else public.has_business_access(p_business)
  end;
$$;

-- ---------------------------------------------------------------------
-- claim_prime: secure first-user setup. The first authenticated user to
-- call this becomes PRIME of the seeded organization. Refuses forever
-- after. No email is hard-coded anywhere.
-- ---------------------------------------------------------------------
create or replace function public.claim_prime()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_role uuid;
  v_membership uuid;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  -- serialize concurrent claims
  perform pg_advisory_xact_lock(hashtext('jarvis_claim_prime'));

  select id into v_org from public.organizations order by created_at limit 1;
  if v_org is null then
    raise exception 'organization not seeded';
  end if;

  select id into v_role from public.roles where key = 'prime';
  if v_role is null then
    raise exception 'prime role not seeded';
  end if;

  if exists (
    select 1 from public.memberships m
    where m.organization_id = v_org and m.role_id = v_role and m.status = 'active'
  ) then
    raise exception 'PRIME has already been claimed';
  end if;

  insert into public.memberships (organization_id, business_id, profile_id, role_id, authority_level)
  values (v_org, null, v_uid, v_role, 'L5')
  returning id into v_membership;

  insert into public.audit_logs (organization_id, actor_type, actor_id, action, resource_type, resource_id)
  values (v_org, 'user', v_uid, 'prime.claimed', 'membership', v_membership);

  return v_membership;
end;
$$;

revoke all on function public.claim_prime() from public, anon;
grant execute on function public.claim_prime() to authenticated;

-- ---------------------------------------------------------------------
-- Enable RLS everywhere.
-- ---------------------------------------------------------------------
alter table public.organizations      enable row level security;
alter table public.businesses         enable row level security;
alter table public.profiles           enable row level security;
alter table public.roles              enable row level security;
alter table public.permissions        enable row level security;
alter table public.role_permissions   enable row level security;
alter table public.memberships        enable row level security;
alter table public.agents             enable row level security;
alter table public.agent_permissions  enable row level security;
alter table public.objectives         enable row level security;
alter table public.projects           enable row level security;
alter table public.tasks              enable row level security;
alter table public.task_dependencies  enable row level security;
alter table public.decisions          enable row level security;
alter table public.approvals          enable row level security;
alter table public.notifications      enable row level security;
alter table public.documents          enable row level security;
alter table public.document_versions  enable row level security;
alter table public.agent_runs         enable row level security;
alter table public.agent_messages     enable row level security;
alter table public.tool_calls         enable row level security;
alter table public.model_usage        enable row level security;
alter table public.audit_logs         enable row level security;
alter table public.daily_briefs       enable row level security;
alter table public.system_events      enable row level security;

-- ---------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------

-- organizations: members read; only PRIME updates; no client-side create/delete.
drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations
  for select using (id in (select public.my_org_ids()));
drop policy if exists organizations_update on public.organizations;
create policy organizations_update on public.organizations
  for update using (public.is_prime(id)) with check (public.is_prime(id));

-- businesses: scoped read; PRIME writes.
drop policy if exists businesses_select on public.businesses;
create policy businesses_select on public.businesses
  for select using (public.has_business_access(id) or public.is_prime(organization_id));
drop policy if exists businesses_write on public.businesses;
create policy businesses_write on public.businesses
  for all using (public.is_prime(organization_id)) with check (public.is_prime(organization_id));

-- profiles: own row; PRIME sees profiles of members in their org.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (id = auth.uid());
drop policy if exists profiles_select_prime on public.profiles;
create policy profiles_select_prime on public.profiles
  for select using (
    exists (
      select 1 from public.memberships m
      where m.profile_id = public.profiles.id and public.is_prime(m.organization_id)
    )
  );
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- roles / permissions / role_permissions: global reference data, readable
-- by any authenticated user; never writable from the browser.
drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles
  for select using (auth.uid() is not null);
drop policy if exists permissions_select on public.permissions;
create policy permissions_select on public.permissions
  for select using (auth.uid() is not null);
drop policy if exists role_permissions_select on public.role_permissions;
create policy role_permissions_select on public.role_permissions
  for select using (auth.uid() is not null);

-- memberships: own rows; PRIME manages org memberships.
drop policy if exists memberships_select_own on public.memberships;
create policy memberships_select_own on public.memberships
  for select using (profile_id = auth.uid());
drop policy if exists memberships_select_prime on public.memberships;
create policy memberships_select_prime on public.memberships
  for select using (public.is_prime(organization_id));
drop policy if exists memberships_write_prime on public.memberships;
create policy memberships_write_prime on public.memberships
  for all using (public.is_prime(organization_id)) with check (public.is_prime(organization_id));

-- agents: org members (non-client) read; PRIME writes.
drop policy if exists agents_select on public.agents;
create policy agents_select on public.agents
  for select using (public.can_access_scoped(organization_id, business_id) or public.is_prime(organization_id));
drop policy if exists agents_write on public.agents;
create policy agents_write on public.agents
  for all using (public.is_prime(organization_id)) with check (public.is_prime(organization_id));

drop policy if exists agent_permissions_select on public.agent_permissions;
create policy agent_permissions_select on public.agent_permissions
  for select using (
    exists (
      select 1 from public.agents a
      where a.id = agent_id
        and (public.can_access_scoped(a.organization_id, a.business_id) or public.is_prime(a.organization_id))
    )
  );
drop policy if exists agent_permissions_write on public.agent_permissions;
create policy agent_permissions_write on public.agent_permissions
  for all using (
    exists (select 1 from public.agents a where a.id = agent_id and public.is_prime(a.organization_id))
  ) with check (
    exists (select 1 from public.agents a where a.id = agent_id and public.is_prime(a.organization_id))
  );

-- objectives / projects / tasks / decisions: business-scoped read + write;
-- delete reserved for PRIME.
drop policy if exists objectives_select on public.objectives;
create policy objectives_select on public.objectives
  for select using (public.can_access_scoped(organization_id, business_id));
drop policy if exists objectives_insert on public.objectives;
create policy objectives_insert on public.objectives
  for insert with check (public.can_access_scoped(organization_id, business_id));
drop policy if exists objectives_update on public.objectives;
create policy objectives_update on public.objectives
  for update using (public.can_access_scoped(organization_id, business_id))
  with check (public.can_access_scoped(organization_id, business_id));
drop policy if exists objectives_delete on public.objectives;
create policy objectives_delete on public.objectives
  for delete using (public.is_prime(organization_id));

drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select using (public.has_business_access(business_id));
drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects
  for insert with check (public.has_business_access(business_id));
drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects
  for update using (public.has_business_access(business_id))
  with check (public.has_business_access(business_id));
drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects
  for delete using (public.is_prime(organization_id));

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select using (public.has_business_access(business_id));
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert with check (public.has_business_access(business_id));
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update using (public.has_business_access(business_id))
  with check (public.has_business_access(business_id));
drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
  for delete using (public.is_prime(organization_id));

drop policy if exists task_dependencies_select on public.task_dependencies;
create policy task_dependencies_select on public.task_dependencies
  for select using (
    exists (select 1 from public.tasks t where t.id = task_id and public.has_business_access(t.business_id))
  );
drop policy if exists task_dependencies_write on public.task_dependencies;
create policy task_dependencies_write on public.task_dependencies
  for all using (
    exists (select 1 from public.tasks t where t.id = task_id and public.has_business_access(t.business_id))
  ) with check (
    exists (select 1 from public.tasks t where t.id = task_id and public.has_business_access(t.business_id))
  );

drop policy if exists decisions_select on public.decisions;
create policy decisions_select on public.decisions
  for select using (public.can_access_scoped(organization_id, business_id));
drop policy if exists decisions_insert on public.decisions;
create policy decisions_insert on public.decisions
  for insert with check (public.can_access_scoped(organization_id, business_id));
drop policy if exists decisions_update on public.decisions;
create policy decisions_update on public.decisions
  for update using (public.is_prime(organization_id)) with check (public.is_prime(organization_id));
drop policy if exists decisions_delete on public.decisions;
create policy decisions_delete on public.decisions
  for delete using (public.is_prime(organization_id));

-- approvals: scoped read; members may request; ONLY PRIME may change state.
drop policy if exists approvals_select on public.approvals;
create policy approvals_select on public.approvals
  for select using (public.can_access_scoped(organization_id, business_id) or public.is_prime(organization_id));
drop policy if exists approvals_insert on public.approvals;
create policy approvals_insert on public.approvals
  for insert with check (
    requested_by_user_id = auth.uid()
    and public.can_access_scoped(organization_id, business_id)
  );
drop policy if exists approvals_update_prime on public.approvals;
create policy approvals_update_prime on public.approvals
  for update using (public.is_prime(organization_id)) with check (public.is_prime(organization_id));

-- notifications: recipients read/update their own; server (service role) inserts.
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select using (recipient_id = auth.uid());
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

-- documents: business-scoped; 'restricted' classification is PRIME-only.
drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents
  for select using (
    public.can_access_scoped(organization_id, business_id)
    and (classification <> 'restricted' or public.is_prime(organization_id))
  );
drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents
  for insert with check (public.can_access_scoped(organization_id, business_id));
drop policy if exists documents_update on public.documents;
create policy documents_update on public.documents
  for update using (
    public.can_access_scoped(organization_id, business_id)
    and (classification <> 'restricted' or public.is_prime(organization_id))
  ) with check (public.can_access_scoped(organization_id, business_id));
drop policy if exists documents_delete on public.documents;
create policy documents_delete on public.documents
  for delete using (public.is_prime(organization_id));

drop policy if exists document_versions_select on public.document_versions;
create policy document_versions_select on public.document_versions
  for select using (
    exists (
      select 1 from public.documents d
      where d.id = document_id
        and public.can_access_scoped(d.organization_id, d.business_id)
        and (d.classification <> 'restricted' or public.is_prime(d.organization_id))
    )
  );

-- agent_runs / agent_messages / tool_calls / model_usage:
-- read-only for scoped members; written only by the server (service role).
drop policy if exists agent_runs_select on public.agent_runs;
create policy agent_runs_select on public.agent_runs
  for select using (public.can_access_scoped(organization_id, business_id) or public.is_prime(organization_id));

drop policy if exists agent_messages_select on public.agent_messages;
create policy agent_messages_select on public.agent_messages
  for select using (
    exists (
      select 1 from public.agent_runs r
      where r.id = run_id
        and (public.can_access_scoped(r.organization_id, r.business_id) or public.is_prime(r.organization_id))
    )
  );

drop policy if exists tool_calls_select on public.tool_calls;
create policy tool_calls_select on public.tool_calls
  for select using (public.can_access_scoped(organization_id, business_id) or public.is_prime(organization_id));

drop policy if exists model_usage_select on public.model_usage;
create policy model_usage_select on public.model_usage
  for select using (public.is_prime(organization_id));

-- audit_logs: PRIME read-only. No insert/update/delete policies —
-- only the service role writes, and the append-only trigger blocks
-- mutation even for the service role.
drop policy if exists audit_logs_select_prime on public.audit_logs;
create policy audit_logs_select_prime on public.audit_logs
  for select using (organization_id is not null and public.is_prime(organization_id));

-- daily_briefs: PRIME only.
drop policy if exists daily_briefs_select on public.daily_briefs;
create policy daily_briefs_select on public.daily_briefs
  for select using (public.is_prime(organization_id));

-- system_events: PRIME read; server writes.
drop policy if exists system_events_select on public.system_events;
create policy system_events_select on public.system_events
  for select using (public.is_prime(organization_id));
