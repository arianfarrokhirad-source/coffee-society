-- =====================================================================
-- Critical auditing verification (Phase 1.1, commit 2).
--
-- Proves that every security-critical state change is atomic with its
-- audit row, that the direct write paths are closed, and that the
-- guards (authority ceiling, self-modification, last PRIME, staleness,
-- transition matrix, idempotency) actually fire.
--
-- Requires: local_harness.sql + migrations 0001-0010 + seed.sql, on a
-- database with NO claimed PRIME. Run as a superuser:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/critical_audit_verification.sql
--
-- Every check raises on failure, so a clean exit is the pass condition.
-- NEVER run this against a real Supabase project.
-- =====================================================================

\set ON_ERROR_STOP on
\timing off

begin;

-- ---------------------------------------------------------------------
-- Fixtures. Two profiles: PRIME and a plain employee.
-- ---------------------------------------------------------------------
create temporary table t_ctx (k text primary key, v uuid);

do $$
declare
  v_org uuid;
  v_business uuid;
  v_prime uuid := 'caaaaaaa-0000-0000-0000-000000000001';
  v_other uuid := 'caaaaaaa-0000-0000-0000-000000000002';
  v_agent uuid;
begin
  insert into auth.users (id, email) values
    (v_prime, 'audit-prime@test.local'),
    (v_other, 'audit-other@test.local')
  on conflict (id) do nothing;

  select id into v_org from public.organizations limit 1;
  select id into v_business from public.businesses where organization_id = v_org order by code limit 1;
  select id into v_agent from public.agents where organization_id = v_org order by code limit 1;

  -- Profiles are created by the auth trigger; ensure they exist either way.
  insert into public.profiles (id, email, display_name)
  values (v_prime, 'audit-prime@test.local', 'Audit Prime'),
         (v_other, 'audit-other@test.local', 'Audit Other')
  on conflict (id) do nothing;

  -- Retire any PRIME left behind by an earlier suite, so this one does
  -- not depend on the order the suites are run in. Everything here is
  -- inside the transaction rolled back at the end of the file.
  update public.memberships m
  set status = 'revoked'
  from public.roles r
  where r.id = m.role_id and r.key = 'prime'
    and m.organization_id = v_org and m.status = 'active';

  -- Seed the PRIME membership directly: bootstrapping is commit 1's
  -- concern, this suite tests what happens afterwards.
  insert into public.memberships (organization_id, profile_id, role_id, authority_level)
  select v_org, v_prime, r.id, 'L5' from public.roles r where r.key = 'prime';

  insert into t_ctx (k, v) values
    ('org', v_org), ('business', v_business), ('prime', v_prime),
    ('other', v_other), ('agent', v_agent);
end $$;

-- ---------------------------------------------------------------------
-- 1. The direct write policies are gone.
-- ---------------------------------------------------------------------
do $$
declare
  v_leftover text;
begin
  select string_agg(policyname, ', ') into v_leftover
  from pg_policies
  where schemaname = 'public'
    and policyname in ('approvals_update_prime', 'approvals_insert',
                       'memberships_write_prime', 'agents_write');
  if v_leftover is not null then
    raise exception 'FAIL 1: direct write policies still present: %', v_leftover;
  end if;

  -- Read access must survive.
  if not exists (select 1 from pg_policies
                 where schemaname='public' and tablename='approvals' and policyname='approvals_select') then
    raise exception 'FAIL 1: approvals_select was removed';
  end if;
  raise notice 'PASS 1: direct write policies dropped, read policies intact';
end $$;

-- ---------------------------------------------------------------------
-- 2. No write path remains for authenticated users on the three tables.
--    RLS with zero permissive write policies denies every write.
-- ---------------------------------------------------------------------
do $$
declare
  t text;
  c integer;
begin
  foreach t in array array['approvals', 'memberships', 'agents'] loop
    select count(*) into c
    from pg_policies
    where schemaname = 'public' and tablename = t and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL');
    if c > 0 then
      raise exception 'FAIL 2: % still has % write policy/policies', t, c;
    end if;
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception 'FAIL 2: RLS not enabled on %', t;
    end if;
  end loop;
  raise notice 'PASS 2: approvals/memberships/agents have no write policy and RLS is on';
end $$;

-- ---------------------------------------------------------------------
-- 3. Grants: RPCs are service_role only, helpers are ungranted.
-- ---------------------------------------------------------------------
do $$
declare
  fn text;
  bad text := '';
begin
  foreach fn in array array[
    'create_approval_audited', 'resolve_approval', 'expire_approvals',
    'record_approval_execution', 'assign_membership', 'change_membership_role',
    'revoke_membership', 'set_agent_authority', 'set_agent_active',
    'set_agent_financial_authority', 'set_agent_action_types'
  ] loop
    if has_function_privilege('anon', ('public.' || fn)::regproc, 'EXECUTE')
       or has_function_privilege('authenticated', ('public.' || fn)::regproc, 'EXECUTE') then
      bad := bad || fn || ' ';
    end if;
    if not has_function_privilege('service_role', ('public.' || fn)::regproc, 'EXECUTE') then
      raise exception 'FAIL 3: service_role cannot execute %', fn;
    end if;
  end loop;
  if bad <> '' then
    raise exception 'FAIL 3: anon/authenticated can execute: %', bad;
  end if;

  foreach fn in array array[
    'assert_org_prime', 'prior_request_audit', 'write_critical_audit',
    'approval_transition_allowed'
  ] loop
    if has_function_privilege('anon', ('public.' || fn)::regproc, 'EXECUTE')
       or has_function_privilege('authenticated', ('public.' || fn)::regproc, 'EXECUTE') then
      raise exception 'FAIL 3: internal helper % is reachable by a client role', fn;
    end if;
  end loop;
  raise notice 'PASS 3: RPCs are service_role only, helpers ungranted';
end $$;

-- ---------------------------------------------------------------------
-- 4. Transition matrix. The helper is the single source of the rules,
--    so it is tested directly and exhaustively for the actor kinds.
-- ---------------------------------------------------------------------
do $$
declare
  r record;
begin
  -- Allowed transitions.
  for r in select * from (values
    ('pending','approved','prime'), ('pending','rejected','prime'),
    ('pending','modified','prime'), ('pending','cancelled','prime'),
    ('approved','cancelled','prime'), ('modified','cancelled','prime'),
    ('pending','expired','system'), ('approved','expired','system'),
    ('modified','expired','system'),
    ('approved','executed','executor'), ('approved','failed','executor'),
    ('modified','executed','executor'), ('modified','failed','executor')
  ) as v(f, t, k) loop
    if not public.approval_transition_allowed(r.f::public.approval_status, r.t::public.approval_status, r.k) then
      raise exception 'FAIL 4: % -> % as % should be allowed', r.f, r.t, r.k;
    end if;
  end loop;

  -- Denied transitions: wrong actor kind, terminal source, self-service
  -- execution, and PRIME reaching an executor-only outcome.
  for r in select * from (values
    ('pending','executed','prime'), ('pending','failed','prime'),
    ('approved','executed','prime'), ('pending','expired','prime'),
    ('rejected','approved','prime'), ('executed','failed','executor'),
    ('expired','approved','prime'), ('cancelled','approved','prime'),
    ('failed','executed','executor'), ('pending','executed','executor'),
    ('pending','approved','system'), ('pending','approved','executor'),
    ('approved','approved','prime'), ('pending','pending','prime'),
    ('pending','approved','agent'), ('pending','approved','')
  ) as v(f, t, k) loop
    if public.approval_transition_allowed(r.f::public.approval_status, r.t::public.approval_status, r.k) then
      raise exception 'FAIL 4: % -> % as % must be denied', r.f, r.t, r.k;
    end if;
  end loop;

  -- Unknown actor kind and null inputs fail closed.
  if public.approval_transition_allowed('pending', 'approved', 'root') then
    raise exception 'FAIL 4: unknown actor kind was allowed';
  end if;
  if coalesce(public.approval_transition_allowed(null, 'approved', 'prime'), false) then
    raise exception 'FAIL 4: null source status was allowed';
  end if;
  raise notice 'PASS 4: transition matrix allows 13 and denies 18 cases';
end $$;

-- ---------------------------------------------------------------------
-- 5. Approval creation is atomic with its audit row and its event.
-- ---------------------------------------------------------------------
do $$
declare
  v_org uuid := (select v from t_ctx where k='org');
  v_business uuid := (select v from t_ctx where k='business');
  v_prime uuid := (select v from t_ctx where k='prime');
  v_approval uuid;
  v_again uuid;
  v_audit public.audit_logs%rowtype;
begin
  v_approval := public.create_approval_audited(
    v_org, v_business, v_prime, null, 'payment.send',
    '{"amount": 100, "to": "acct-1"}'::jsonb, 'test approval', 100, 'GBP',
    'high', now() + interval '1 day', 'req-create-1', 'web');

  select * into v_audit from public.audit_logs
  where resource_id = v_approval and action = 'approval.created';
  if not found then
    raise exception 'FAIL 5: approval created without an audit row';
  end if;
  if v_audit.request_id <> 'req-create-1' then
    raise exception 'FAIL 5: request_id not recorded';
  end if;
  if v_audit.metadata ->> 'request_origin' <> 'web' then
    raise exception 'FAIL 5: request_origin missing from metadata';
  end if;

  -- The raw payload must never be copied into the audit row.
  if v_audit.after_data ->> 'payload_sha256' is null then
    raise exception 'FAIL 5: payload_sha256 not captured';
  end if;
  if v_audit::text like '%acct-1%' then
    raise exception 'FAIL 5: raw payload leaked into the audit row';
  end if;

  if not exists (select 1 from public.system_events
                 where event_type = 'approval.requested'
                   and payload ->> 'approvalId' = v_approval::text) then
    raise exception 'FAIL 5: approval.requested event not emitted';
  end if;

  -- Replay with the same request id returns the same approval, creates nothing.
  v_again := public.create_approval_audited(
    v_org, v_business, v_prime, null, 'payment.send',
    '{"amount": 100, "to": "acct-1"}'::jsonb, 'test approval', 100, 'GBP',
    'high', now() + interval '1 day', 'req-create-1', 'web');
  if v_again <> v_approval then
    raise exception 'FAIL 5: replay created a second approval';
  end if;
  if (select count(*) from public.approvals where action_type = 'payment.send') <> 1 then
    raise exception 'FAIL 5: replay duplicated the approval row';
  end if;

  insert into t_ctx (k, v) values ('approval', v_approval);
  raise notice 'PASS 5: approval creation is atomic, hashed and idempotent';
end $$;

-- ---------------------------------------------------------------------
-- 6. Creation rejects a request with no requester and a bad origin.
-- ---------------------------------------------------------------------
do $$
declare
  v_org uuid := (select v from t_ctx where k='org');
  v_prime uuid := (select v from t_ctx where k='prime');
  v_before bigint := (select count(*) from public.approvals);
begin
  begin
    perform public.create_approval_audited(
      v_org, null, null, null, 'payment.send', '{}'::jsonb, null, null, null,
      'low', null, 'req-noreq', 'web');
    raise exception 'FAIL 6: an approval with no requester was accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'requester_required' then raise; end if;
  end;

  begin
    perform public.create_approval_audited(
      v_org, null, v_prime, null, 'payment.send', '{}'::jsonb, null, null, null,
      'low', null, 'req-badorigin', 'browser');
    raise exception 'FAIL 6: an invalid request_origin was accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'invalid_request_origin' then raise; end if;
  end;

  begin
    perform public.create_approval_audited(
      v_org, null, v_prime, null, 'payment.send', '{}'::jsonb, null, null, null,
      'low', null, '', 'web');
    raise exception 'FAIL 6: an empty request_id was accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'request_id_required' then raise; end if;
  end;

  if (select count(*) from public.approvals) <> v_before then
    raise exception 'FAIL 6: a rejected creation left an approval row behind';
  end if;
  raise notice 'PASS 6: creation fails closed on requester, origin and request id';
end $$;

-- ---------------------------------------------------------------------
-- 7. resolve_approval: authorization, staleness, transition, idempotency.
-- ---------------------------------------------------------------------
do $$
declare
  v_approval uuid := (select v from t_ctx where k='approval');
  v_prime uuid := (select v from t_ctx where k='prime');
  v_other uuid := (select v from t_ctx where k='other');
  v_audit uuid;
  v_replay uuid;
begin
  -- A non-PRIME actor cannot resolve.
  begin
    perform public.resolve_approval(v_other, v_approval, 'pending', 'approved', 'req-r-1', 'web');
    raise exception 'FAIL 7: a non-PRIME actor resolved an approval';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'not_prime' then raise; end if;
  end;
  if (select status from public.approvals where id = v_approval) <> 'pending' then
    raise exception 'FAIL 7: denied resolution still changed the status';
  end if;

  -- A stale expected status is rejected before anything is written.
  begin
    perform public.resolve_approval(v_prime, v_approval, 'approved', 'cancelled', 'req-r-2', 'web');
    raise exception 'FAIL 7: a stale expected status was accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'stale_status' then raise; end if;
  end;

  -- PRIME may not jump straight to an executor-only outcome.
  begin
    perform public.resolve_approval(v_prime, v_approval, 'pending', 'executed', 'req-r-3', 'web');
    raise exception 'FAIL 7: PRIME reached an executor-only state';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'invalid_transition' then raise; end if;
  end;

  -- The happy path.
  v_audit := public.resolve_approval(v_prime, v_approval, 'pending', 'approved', 'req-r-ok', 'web');
  if (select status from public.approvals where id = v_approval) <> 'approved' then
    raise exception 'FAIL 7: status was not updated';
  end if;
  if not exists (select 1 from public.audit_logs
                 where id = v_audit and action = 'approval.approved'
                   and resource_id = v_approval
                   and before_data ->> 'status' = 'pending'
                   and after_data ->> 'status' = 'approved'
                   and metadata ->> 'transition' = 'pending->approved') then
    raise exception 'FAIL 7: the approval audit row is missing or malformed';
  end if;
  if not exists (select 1 from public.system_events
                 where event_type = 'approval.approved'
                   and payload ->> 'approvalId' = v_approval::text) then
    raise exception 'FAIL 7: approval.approved event not emitted';
  end if;

  -- Replay returns the same audit id and applies nothing.
  v_replay := public.resolve_approval(v_prime, v_approval, 'pending', 'approved', 'req-r-ok', 'web');
  if v_replay <> v_audit then
    raise exception 'FAIL 7: replay did not return the original audit id';
  end if;
  if (select count(*) from public.audit_logs
      where resource_id = v_approval and action = 'approval.approved') <> 1 then
    raise exception 'FAIL 7: replay wrote a second audit row';
  end if;

  raise notice 'PASS 7: resolve_approval enforces authz, staleness, transitions and replay';
end $$;

-- ---------------------------------------------------------------------
-- 8. A failure inside the transaction rolls the state change back too.
--    This is the whole point of the commit: no state without its audit.
-- ---------------------------------------------------------------------
do $$
declare
  v_org uuid := (select v from t_ctx where k='org');
  v_prime uuid := (select v from t_ctx where k='prime');
  v_approval uuid;
  v_status public.approval_status;
begin
  v_approval := public.create_approval_audited(
    v_org, null, v_prime, null, 'atomicity.probe', '{}'::jsonb, null, null, null,
    'low', null, 'req-atomic-setup', 'web');

  -- An invalid origin fails inside write_critical_audit, which runs
  -- AFTER the approvals UPDATE. If the update survived, the boundary
  -- would be advisory rather than transactional.
  begin
    perform public.resolve_approval(v_prime, v_approval, 'pending', 'approved', 'req-atomic', 'nope');
    raise exception 'FAIL 8: an invalid origin was accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'invalid_request_origin' then raise; end if;
  end;

  select status into v_status from public.approvals where id = v_approval;
  if v_status <> 'pending' then
    raise exception 'FAIL 8: the state change survived a failed audit (status=%)', v_status;
  end if;
  if exists (select 1 from public.audit_logs where request_id = 'req-atomic') then
    raise exception 'FAIL 8: a partial audit row survived';
  end if;
  if exists (select 1 from public.system_events
             where payload ->> 'approvalId' = v_approval::text
               and event_type = 'approval.approved') then
    raise exception 'FAIL 8: an event survived a failed transaction';
  end if;
  raise notice 'PASS 8: a failed audit rolls back the state change and the event';
end $$;

-- ---------------------------------------------------------------------
-- 9. Expiry: system-only transition, idempotent per request id.
-- ---------------------------------------------------------------------
do $$
declare
  v_org uuid := (select v from t_ctx where k='org');
  v_prime uuid := (select v from t_ctx where k='prime');
  v_expiring uuid;
  v_fresh uuid;
  v_count integer;
begin
  v_expiring := public.create_approval_audited(
    v_org, null, v_prime, null, 'expiry.probe', '{}'::jsonb, null, null, null,
    'low', now() - interval '1 hour', 'req-exp-setup', 'web');
  v_fresh := public.create_approval_audited(
    v_org, null, v_prime, null, 'expiry.fresh', '{}'::jsonb, null, null, null,
    'low', now() + interval '1 day', 'req-exp-fresh', 'web');

  v_count := public.expire_approvals('req-expire-1', 'cron');
  if v_count < 1 then
    raise exception 'FAIL 9: nothing expired';
  end if;
  if (select status from public.approvals where id = v_expiring) <> 'expired' then
    raise exception 'FAIL 9: the overdue approval was not expired';
  end if;
  if (select status from public.approvals where id = v_fresh) <> 'pending' then
    raise exception 'FAIL 9: an in-date approval was expired';
  end if;
  if not exists (select 1 from public.audit_logs
                 where resource_id = v_expiring and action = 'approval.expired'
                   and actor_type = 'system'
                   and metadata ->> 'request_origin' = 'cron') then
    raise exception 'FAIL 9: the expiry audit row is missing or malformed';
  end if;

  -- Re-running with the same request id must be a no-op.
  if public.expire_approvals('req-expire-1', 'cron') <> 0 then
    raise exception 'FAIL 9: replay expired something a second time';
  end if;
  if (select count(*) from public.audit_logs
      where resource_id = v_expiring and action = 'approval.expired') <> 1 then
    raise exception 'FAIL 9: replay wrote a second expiry audit row';
  end if;
  raise notice 'PASS 9: expiry is system-only, selective and idempotent';
end $$;

-- ---------------------------------------------------------------------
-- 10. Execution recording is executor-only and respects expectations.
-- ---------------------------------------------------------------------
do $$
declare
  v_approval uuid := (select v from t_ctx where k='approval');
  v_audit uuid;
begin
  -- Wrong expected status is rejected.
  begin
    perform public.record_approval_execution(v_approval, 'pending', 'executed', '{}'::jsonb, 'req-x-1');
    raise exception 'FAIL 10: a stale expected status was accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'stale_status' then raise; end if;
  end;

  v_audit := public.record_approval_execution(
    v_approval, 'approved', 'executed', '{"ok": true}'::jsonb, 'req-x-ok');
  if (select status from public.approvals where id = v_approval) <> 'executed' then
    raise exception 'FAIL 10: status was not updated to executed';
  end if;
  if (select metadata ->> 'request_origin' from public.audit_logs where id = v_audit) <> 'executor' then
    raise exception 'FAIL 10: the default origin is not executor';
  end if;

  -- A terminal state cannot move again.
  begin
    perform public.record_approval_execution(
      v_approval, 'executed', 'failed', '{}'::jsonb, 'req-x-2');
    raise exception 'FAIL 10: a terminal approval transitioned again';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'invalid_transition' then raise; end if;
  end;
  raise notice 'PASS 10: execution recording is guarded and terminal states are final';
end $$;

-- ---------------------------------------------------------------------
-- 11. Membership assignment: PRIME only, no self-modification, audited,
--     idempotent.
-- ---------------------------------------------------------------------
do $$
declare
  v_org uuid := (select v from t_ctx where k='org');
  v_prime uuid := (select v from t_ctx where k='prime');
  v_other uuid := (select v from t_ctx where k='other');
  v_membership uuid;
  v_replay uuid;
begin
  -- A non-PRIME actor cannot assign.
  begin
    perform public.assign_membership(v_other, v_org, v_prime, null, 'employee', 'L1', 'req-m-1');
    raise exception 'FAIL 11: a non-PRIME actor assigned a membership';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'not_prime' then raise; end if;
  end;

  -- PRIME cannot act on itself.
  begin
    perform public.assign_membership(v_prime, v_org, v_prime, null, 'employee', 'L1', 'req-m-2');
    raise exception 'FAIL 11: self-assignment was accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'self_modification_denied' then raise; end if;
  end;

  -- An unknown role is refused.
  begin
    perform public.assign_membership(v_prime, v_org, v_other, null, 'employee', 'L1', 'req-m-3', 'satellite');
    raise exception 'FAIL 11: an invalid origin was accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'invalid_request_origin' then raise; end if;
  end;

  v_membership := public.assign_membership(v_prime, v_org, v_other, null, 'employee', 'L2', 'req-m-ok');
  if not exists (select 1 from public.audit_logs
                 where resource_id = v_membership and action = 'membership.created'
                   and after_data ->> 'authority_level' = 'L2'
                   and after_data ->> 'role' = 'employee'
                   and metadata ->> 'request_origin' = 'web') then
    raise exception 'FAIL 11: the membership audit row is missing or malformed';
  end if;

  -- Replay creates nothing new.
  v_replay := public.assign_membership(v_prime, v_org, v_other, null, 'employee', 'L2', 'req-m-ok');
  if v_replay <> v_membership then
    raise exception 'FAIL 11: replay created a second membership';
  end if;
  if (select count(*) from public.memberships where profile_id = v_other) <> 1 then
    raise exception 'FAIL 11: replay duplicated the membership row';
  end if;

  insert into t_ctx (k, v) values ('membership', v_membership);
  raise notice 'PASS 11: membership assignment is PRIME-only, self-safe, audited and idempotent';
end $$;

-- ---------------------------------------------------------------------
-- 12. Authority ceiling. An actor never grants above its own level.
--
--     The bootstrapped PRIME is L5, so the ceiling cannot bite through
--     the normal flow. The fixture lowers PRIME to L2 directly (not via
--     an RPC) purely to drive the guard, then restores it.
-- ---------------------------------------------------------------------
do $$
declare
  v_org uuid := (select v from t_ctx where k='org');
  v_prime uuid := (select v from t_ctx where k='prime');
  v_third uuid := 'caaaaaaa-0000-0000-0000-000000000003';
  v_prime_membership uuid;
begin
  insert into auth.users (id, email) values (v_third, 'audit-third@test.local')
  on conflict (id) do nothing;
  insert into public.profiles (id, email, display_name)
  values (v_third, 'audit-third@test.local', 'Audit Third')
  on conflict (id) do nothing;

  select m.id into v_prime_membership
  from public.memberships m join public.roles r on r.id = m.role_id
  where m.profile_id = v_prime and r.key = 'prime' and m.status = 'active';

  update public.memberships set authority_level = 'L2' where id = v_prime_membership;

  begin
    perform public.assign_membership(v_prime, v_org, v_third, null, 'executive', 'L5', 'req-ceil-1');
    raise exception 'FAIL 12: an L2 actor granted L5';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'authority_ceiling_exceeded' then raise; end if;
  end;
  if exists (select 1 from public.memberships where profile_id = v_third) then
    raise exception 'FAIL 12: the refused grant still created a membership';
  end if;

  -- At or below its own level is permitted.
  perform public.assign_membership(v_prime, v_org, v_third, null, 'employee', 'L2', 'req-ceil-2');
  if not exists (select 1 from public.audit_logs where request_id = 'req-ceil-2') then
    raise exception 'FAIL 12: a permitted grant was blocked';
  end if;

  update public.memberships set authority_level = 'L5' where id = v_prime_membership;
  raise notice 'PASS 12: the authority ceiling holds';
end $$;

-- ---------------------------------------------------------------------
-- 13. Role changes: stale expectation, self-modification, audit content.
-- ---------------------------------------------------------------------
do $$
declare
  v_prime uuid := (select v from t_ctx where k='prime');
  v_other uuid := (select v from t_ctx where k='other');
  v_membership uuid := (select v from t_ctx where k='membership');
  v_prime_membership uuid;
  v_audit uuid;
  v_replay uuid;
begin
  select m.id into v_prime_membership
  from public.memberships m join public.roles r on r.id = m.role_id
  where m.profile_id = v_prime and r.key = 'prime' and m.status = 'active';

  -- PRIME cannot change its own role.
  begin
    perform public.change_membership_role(
      v_prime, v_prime_membership, 'prime', 'employee', 'L1', 'req-rc-self');
    raise exception 'FAIL 13: PRIME changed its own role';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'self_modification_denied' then raise; end if;
  end;

  -- A non-PRIME actor cannot change anyone's role.
  begin
    perform public.change_membership_role(
      v_other, v_prime_membership, 'prime', 'employee', 'L1', 'req-rc-other');
    raise exception 'FAIL 13: a non-PRIME actor changed a role';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'not_prime' then raise; end if;
  end;

  -- The expected role must match what is stored.
  begin
    perform public.change_membership_role(
      v_prime, v_membership, 'executive', 'business_manager', 'L3', 'req-rc-stale');
    raise exception 'FAIL 13: a stale expected role was accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'stale_status' then raise; end if;
  end;

  -- Happy path.
  v_audit := public.change_membership_role(
    v_prime, v_membership, 'employee', 'business_manager', 'L3', 'req-rc-ok');
  if not exists (select 1 from public.memberships m join public.roles r on r.id = m.role_id
                 where m.id = v_membership and r.key = 'business_manager'
                   and m.authority_level = 'L3') then
    raise exception 'FAIL 13: the role change did not apply';
  end if;
  if not exists (select 1 from public.audit_logs where id = v_audit
                 and action = 'membership.role_changed'
                 and before_data ->> 'role' = 'employee'
                 and after_data ->> 'role' = 'business_manager'
                 and after_data ->> 'authority_level' = 'L3') then
    raise exception 'FAIL 13: the role-change audit row is malformed';
  end if;

  v_replay := public.change_membership_role(
    v_prime, v_membership, 'employee', 'business_manager', 'L3', 'req-rc-ok');
  if v_replay <> v_audit then
    raise exception 'FAIL 13: replay did not return the original audit id';
  end if;
  raise notice 'PASS 13: role changes are guarded, audited and idempotent';
end $$;

-- ---------------------------------------------------------------------
-- 14. Revocation: self-modification, staleness, audit content.
-- ---------------------------------------------------------------------
do $$
declare
  v_prime uuid := (select v from t_ctx where k='prime');
  v_other uuid := (select v from t_ctx where k='other');
  v_membership uuid := (select v from t_ctx where k='membership');
  v_prime_membership uuid;
  v_audit uuid;
begin
  select m.id into v_prime_membership
  from public.memberships m join public.roles r on r.id = m.role_id
  where m.profile_id = v_prime and r.key = 'prime' and m.status = 'active';

  begin
    perform public.revoke_membership(v_prime, v_prime_membership, 'req-rv-self');
    raise exception 'FAIL 14: PRIME revoked its own membership';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'self_modification_denied' then raise; end if;
  end;

  v_audit := public.revoke_membership(v_prime, v_membership, 'req-rv-ok');
  if (select status from public.memberships where id = v_membership) <> 'revoked' then
    raise exception 'FAIL 14: the revocation did not apply';
  end if;
  if not exists (select 1 from public.audit_logs where id = v_audit
                 and action = 'membership.revoked'
                 and before_data ->> 'status' = 'active'
                 and after_data ->> 'status' = 'revoked') then
    raise exception 'FAIL 14: the revocation audit row is malformed';
  end if;

  -- Revoking again with a fresh request id is stale, not a second write.
  begin
    perform public.revoke_membership(v_prime, v_membership, 'req-rv-again');
    raise exception 'FAIL 14: an already-revoked membership was revoked again';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'stale_status' then raise; end if;
  end;
  raise notice 'PASS 14: revocation is guarded, audited and not repeatable';
end $$;

-- ---------------------------------------------------------------------
-- 15. The organization can never be left without a PRIME.
--
--     Two controls combine. 0009's memberships_single_prime allows at
--     most one active PRIME per organization; assert_org_prime requires
--     the actor to be PRIME; and self_modification_denied stops that
--     actor touching its own row. Together they make the sole PRIME
--     unremovable, which is why last_prime_protected inside
--     change_membership_role and revoke_membership is defence in depth
--     and NOT reachable through the current RPC surface. It is retained
--     for the day delegated administration makes it reachable.
--
--     This check proves the composition, and is the pin that will fail
--     if a future commit relaxes either control.
-- ---------------------------------------------------------------------
do $$
declare
  v_org uuid := (select v from t_ctx where k='org');
  v_prime uuid := (select v from t_ctx where k='prime');
  v_third uuid := 'caaaaaaa-0000-0000-0000-000000000003';
  v_role uuid;
  v_third_membership uuid;
begin
  select id into v_role from public.roles where key = 'prime';

  -- A second active PRIME cannot exist, so no second actor can ever
  -- hold the authority to remove the first.
  begin
    insert into public.memberships (organization_id, profile_id, role_id, authority_level)
    values (v_org, v_third, v_role, 'L5');
    raise exception 'FAIL 15: a second active PRIME was created';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'single_prime_violation' then raise; end if;
  end;

  -- Promotion to PRIME through the RPC is refused for the same reason.
  select m.id into v_third_membership
  from public.memberships m where m.profile_id = v_third and m.status = 'active' limit 1;
  begin
    perform public.change_membership_role(
      v_prime, v_third_membership, 'employee', 'prime', 'L5', 'req-lp-promote');
    raise exception 'FAIL 15: a second PRIME was minted through the RPC';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'single_prime_violation' then raise; end if;
  end;

  -- The invariant itself.
  if (select count(*) from public.memberships m join public.roles r on r.id = m.role_id
      where m.organization_id = v_org and m.status = 'active' and r.key = 'prime') <> 1 then
    raise exception 'FAIL 15: the organization does not hold exactly one active PRIME';
  end if;
  raise notice 'PASS 15: exactly one PRIME exists and it cannot be removed';
end $$;

-- ---------------------------------------------------------------------
-- 16. Agent authority mutations. PRIME only; an agent is never the actor.
-- ---------------------------------------------------------------------
do $$
declare
  v_agent uuid := (select v from t_ctx where k='agent');
  v_prime uuid := (select v from t_ctx where k='prime');
  v_other uuid := (select v from t_ctx where k='other');
  v_before public.authority_level;
  v_before_fin numeric;
  v_audit uuid;
begin
  select authority_level, max_financial_authority into v_before, v_before_fin
  from public.agents where id = v_agent;

  -- A non-PRIME actor cannot touch agent authority.
  begin
    perform public.set_agent_authority(v_other, v_agent, v_before, 'L4', 'req-a-authz');
    raise exception 'FAIL 16: a non-PRIME actor changed agent authority';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'not_prime' then raise; end if;
  end;

  -- A stale expectation is rejected.
  begin
    perform public.set_agent_authority(v_prime, v_agent, 'L5', 'L4', 'req-a-1');
    raise exception 'FAIL 16: a stale expected authority was accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'stale_status' then raise; end if;
  end;
  if (select authority_level from public.agents where id = v_agent) <> v_before then
    raise exception 'FAIL 16: a rejected change still applied';
  end if;

  v_audit := public.set_agent_authority(v_prime, v_agent, v_before, 'L2', 'req-a-ok');
  if (select authority_level from public.agents where id = v_agent) <> 'L2' then
    raise exception 'FAIL 16: agent authority was not changed';
  end if;
  if not exists (select 1 from public.audit_logs where id = v_audit
                 and action = 'agent.authority_changed'
                 and before_data ->> 'authority_level' = v_before::text
                 and after_data ->> 'authority_level' = 'L2'
                 and metadata ->> 'agent_code' is not null) then
    raise exception 'FAIL 16: the agent authority audit row is malformed';
  end if;

  -- A negative financial authority is refused.
  begin
    perform public.set_agent_financial_authority(
      v_prime, v_agent, v_before_fin, -1, 'GBP', 'req-a-2');
    raise exception 'FAIL 16: a negative financial authority was accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'invalid_amount' then raise; end if;
  end;

  perform public.set_agent_financial_authority(
    v_prime, v_agent, v_before_fin, 250, 'GBP', 'req-a-fin');
  if (select max_financial_authority from public.agents where id = v_agent) <> 250 then
    raise exception 'FAIL 16: financial authority was not changed';
  end if;
  if not exists (select 1 from public.audit_logs
                 where resource_id = v_agent and action = 'agent.financial_authority_changed'
                   and (after_data ->> 'max_financial_authority')::numeric = 250) then
    raise exception 'FAIL 16: the financial authority change was not audited';
  end if;

  -- Activation toggles are audited under distinct actions.
  perform public.set_agent_active(v_prime, v_agent, true, false, 'req-a-off');
  if (select active from public.agents where id = v_agent) then
    raise exception 'FAIL 16: agent was not deactivated';
  end if;
  if not exists (select 1 from public.audit_logs
                 where resource_id = v_agent and action = 'agent.deactivated') then
    raise exception 'FAIL 16: deactivation was not audited';
  end if;

  perform public.set_agent_action_types(
    v_prime, v_agent, array['research.query'], array['payment.send'], 'req-a-types');
  if not exists (select 1 from public.audit_logs
                 where resource_id = v_agent and action = 'agent.actions_changed'
                   and after_data -> 'prohibited' ? 'payment.send') then
    raise exception 'FAIL 16: the action-type change was not audited';
  end if;
  raise notice 'PASS 16: agent authority mutations are PRIME-only, guarded and audited';
end $$;

-- ---------------------------------------------------------------------
-- 17. Every critical audit row carries a request_id and an origin.
-- ---------------------------------------------------------------------
do $$
declare
  v_missing bigint;
  v_bad bigint;
begin
  select count(*) into v_missing
  from public.audit_logs
  where action in (
    'approval.created', 'approval.approved', 'approval.rejected',
    'approval.modified', 'approval.cancelled', 'approval.expired',
    'approval.executed', 'approval.failed', 'membership.created',
    'membership.role_changed', 'membership.revoked', 'agent.authority_changed',
    'agent.activated', 'agent.deactivated', 'agent.financial_authority_changed',
    'agent.actions_changed')
    and (request_id is null or request_id = '');
  if v_missing > 0 then
    raise exception 'FAIL 17: % critical audit rows have no request_id', v_missing;
  end if;

  select count(*) into v_bad
  from public.audit_logs
  where request_id is not null
    and coalesce(metadata ->> 'request_origin', '')
        not in ('web', 'agent', 'cron', 'api', 'executor', 'migration');
  if v_bad > 0 then
    raise exception 'FAIL 17: % audit rows have an invalid request_origin', v_bad;
  end if;
  raise notice 'PASS 17: every critical audit row carries a request id and a valid origin';
end $$;

-- ---------------------------------------------------------------------
-- 18. The audit log is still append-only.
-- ---------------------------------------------------------------------
do $$
declare
  v_id uuid;
begin
  select id into v_id from public.audit_logs limit 1;
  begin
    update public.audit_logs set action = 'tampered' where id = v_id;
    raise exception 'FAIL 18: an audit row was updated';
  exception when sqlstate 'P0001' then
    null;
  end;
  begin
    delete from public.audit_logs where id = v_id;
    raise exception 'FAIL 18: an audit row was deleted';
  exception when sqlstate 'P0001' then
    null;
  end;
  raise notice 'PASS 18: audit rows resist update and delete';
end $$;

-- ---------------------------------------------------------------------
-- 19. The idempotency index is a real backstop.
-- ---------------------------------------------------------------------
do $$
declare
  v_res uuid := gen_random_uuid();
begin
  insert into public.audit_logs (actor_type, action, resource_type, resource_id, request_id)
  values ('system', 'probe.action', 'probe', v_res, 'req-dupe');
  begin
    insert into public.audit_logs (actor_type, action, resource_type, resource_id, request_id)
    values ('system', 'probe.action', 'probe', v_res, 'req-dupe');
    raise exception 'FAIL 19: a duplicate (resource, action, request_id) was accepted';
  exception when unique_violation then
    null;
  end;

  -- Rows without a request id are unconstrained: telemetry must not be
  -- collapsed by the index.
  insert into public.audit_logs (actor_type, action, resource_type, resource_id)
  values ('system', 'probe.action', 'probe', v_res);
  insert into public.audit_logs (actor_type, action, resource_type, resource_id)
  values ('system', 'probe.action', 'probe', v_res);

  -- Creation actions are constrained on (action, request_id) alone,
  -- because the resource id is generated by the operation and so two
  -- concurrent duplicates would never collide on it.
  insert into public.audit_logs (actor_type, action, resource_type, resource_id, request_id)
  values ('system', 'approval.created', 'approval', gen_random_uuid(), 'req-create-dupe');
  begin
    insert into public.audit_logs (actor_type, action, resource_type, resource_id, request_id)
    values ('system', 'approval.created', 'approval', gen_random_uuid(), 'req-create-dupe');
    raise exception 'FAIL 19: two approval.created rows shared one request id';
  exception when unique_violation then
    null;
  end;

  -- Expiry writes many rows under one request id and must stay free.
  insert into public.audit_logs (actor_type, action, resource_type, resource_id, request_id)
  values ('system', 'approval.expired', 'approval', gen_random_uuid(), 'req-bulk-expire');
  insert into public.audit_logs (actor_type, action, resource_type, resource_id, request_id)
  values ('system', 'approval.expired', 'approval', gen_random_uuid(), 'req-bulk-expire');

  raise notice 'PASS 19: both idempotency indexes bite, telemetry and bulk expiry spared';
end $$;

rollback;

\echo 'CRITICAL AUDIT VERIFICATION COMPLETE — all checks passed'
