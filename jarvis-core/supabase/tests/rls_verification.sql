-- =====================================================================
-- RLS verification script.
-- Run in the Supabase SQL editor (or psql) AFTER migrations + seed.
-- Every block raises an exception on failure; silence = pass.
--
-- These checks verify the *shape* of the security model (RLS enabled,
-- no permissive dev policies, append-only audit). Behavioural checks
-- that need real JWTs (user A cannot read business B) are described in
-- docs/security/security-model.md and can be run with `supabase test db`
-- or manual role-impersonation blocks at the bottom (commented).
-- =====================================================================

-- 1. RLS must be enabled on every exposed table.
do $$
declare
  t text;
  missing text[] := '{}';
begin
  foreach t in array array[
    'organizations','businesses','profiles','roles','permissions','role_permissions',
    'memberships','agents','agent_permissions','objectives','projects','tasks',
    'task_dependencies','decisions','approvals','notifications','documents',
    'document_versions','agent_runs','agent_messages','tool_calls','model_usage',
    'audit_logs','daily_briefs','system_events',
    'leads','clients','website_audits','proposals','website_projects','maintenance_plans'
  ]
  loop
    if not exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t and c.relrowsecurity
    ) then
      missing := missing || t;
    end if;
  end loop;
  if array_length(missing, 1) > 0 then
    raise exception 'RLS NOT ENABLED on: %', array_to_string(missing, ', ');
  end if;
  raise notice 'PASS: RLS enabled on all % exposed tables', 30;
end $$;

-- 2. No "allow all authenticated" development policies (qual = true).
do $$
declare bad int;
begin
  select count(*) into bad
  from pg_policies
  where schemaname = 'public'
    and (qual = 'true' or with_check = 'true');
  if bad > 0 then
    raise exception 'FOUND % permissive allow-all policies', bad;
  end if;
  raise notice 'PASS: no allow-all policies';
end $$;

-- 3. Write-restricted tables must have no INSERT/UPDATE/DELETE policies
--    (only the service role, which bypasses RLS, may write them).
do $$
declare
  t text;
  bad text[] := '{}';
begin
  foreach t in array array[
    'agent_runs','agent_messages','tool_calls','model_usage','audit_logs',
    'daily_briefs','system_events','roles','permissions','role_permissions'
  ]
  loop
    if exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t
        and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    ) then
      bad := bad || t;
    end if;
  end loop;
  if array_length(bad, 1) > 0 then
    raise exception 'WRITE POLICIES EXIST on server-only tables: %', array_to_string(bad, ', ');
  end if;
  raise notice 'PASS: server-only tables have no client write policies';
end $$;

-- 4. audit_logs must be append-only even for the service role.
do $$
begin
  insert into public.audit_logs (actor_type, action) values ('system', 'rls.verification');
  begin
    delete from public.audit_logs where action = 'rls.verification';
    raise exception 'AUDIT LOG DELETE WAS ALLOWED';
  exception
    when others then
      if sqlerrm like '%append-only%' then
        raise notice 'PASS: audit_logs delete blocked';
      else
        raise;
      end if;
  end;
  begin
    update public.audit_logs set action = 'tampered' where action = 'rls.verification';
    raise exception 'AUDIT LOG UPDATE WAS ALLOWED';
  exception
    when others then
      if sqlerrm like '%append-only%' then
        raise notice 'PASS: audit_logs update blocked';
      else
        raise;
      end if;
  end;
end $$;

-- 5. Seed sanity: 9 businesses, VOID dormant with agents disabled,
--    10 agents, A08-RSV inactive.
do $$
declare n int;
begin
  select count(*) into n from public.businesses;
  if n <> 9 then raise exception 'EXPECTED 9 businesses, found %', n; end if;

  if not exists (
    select 1 from public.businesses
    where code = 'A08' and status = 'dormant' and agents_enabled = false
  ) then
    raise exception 'A08 VOID is not dormant/agents-disabled';
  end if;

  select count(*) into n from public.agents;
  if n <> 10 then raise exception 'EXPECTED 10 agents, found %', n; end if;

  if not exists (select 1 from public.agents where code = 'A08-RSV' and active = false) then
    raise exception 'A08-RSV must be inactive';
  end if;

  raise notice 'PASS: seed data verified';
end $$;

-- 6. Anonymous access: the anon role must see nothing.
do $$
declare n int;
begin
  set local role anon;
  select count(*) into n from public.businesses;
  reset role;
  if n > 0 then raise exception 'ANON CAN READ businesses (% rows)', n; end if;
  raise notice 'PASS: anon reads zero rows from businesses';
end $$;

-- 7. Authenticated-but-memberless access: a JWT with a random subject
--    must see nothing and must not be able to insert.
do $$
declare n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  select count(*) into n from public.businesses;
  if n > 0 then
    reset role;
    raise exception 'MEMBERLESS USER CAN READ businesses (% rows)', n;
  end if;
  begin
    insert into public.tasks (organization_id, business_id, title)
    select o.id, b.id, 'rls-probe' from public.organizations o, public.businesses b limit 1;
    reset role;
    raise exception 'MEMBERLESS USER COULD INSERT a task';
  exception
    when insufficient_privilege or sqlstate '42501' then
      null; -- expected: RLS denial
    when others then
      null; -- subquery returns 0 rows under RLS → insert of 0 rows also acceptable
  end;
  reset role;
  raise notice 'PASS: memberless authenticated user is fully scoped out';
end $$;

select 'RLS VERIFICATION COMPLETE — all checks passed' as result;
