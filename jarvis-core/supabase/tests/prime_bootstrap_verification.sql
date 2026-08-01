-- =====================================================================
-- PRIME bootstrap verification (Phase 1.1 commit 1).
-- Run after migrations 0001–0009 + seed on a database WITHOUT a claimed
-- PRIME. Raises on failure; silence (plus NOTICEs) = pass.
-- Covers: grants, legacy removal, nonce validation (invalid/expired/
-- mismatch/replay), atomic rollback on audit failure, happy path,
-- post-claim refusals, and the DB-level single-PRIME guarantee.
-- The concurrency race is exercised separately by race_prime_claim.sh
-- (needs two backends).
-- =====================================================================

-- Test principals
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'founder@test.local'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'attacker@test.local')
on conflict (id) do nothing;

-- 1. Legacy first-user-wins function must be gone.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'claim_prime'
  ) then
    raise exception 'FAIL: legacy claim_prime() still exists';
  end if;
  raise notice 'PASS: legacy claim_prime() removed';
end $$;

-- 2. Grants: anon/authenticated must NOT be able to execute the RPC.
do $$
begin
  if has_function_privilege('anon', 'public.claim_prime_with_nonce(uuid, text)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute claim RPC';
  end if;
  if has_function_privilege('authenticated', 'public.claim_prime_with_nonce(uuid, text)', 'EXECUTE') then
    raise exception 'FAIL: authenticated can execute claim RPC';
  end if;
  if not has_function_privilege('service_role', 'public.claim_prime_with_nonce(uuid, text)', 'EXECUTE') then
    raise exception 'FAIL: service_role cannot execute claim RPC';
  end if;
  raise notice 'PASS: RPC executable by service_role only';
end $$;

-- 3. Nonce table: RLS on, zero policies, hash-only shape.
do $$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'prime_claim_nonces' and c.relrowsecurity
  ) then
    raise exception 'FAIL: prime_claim_nonces has no RLS';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'prime_claim_nonces') then
    raise exception 'FAIL: prime_claim_nonces has client policies';
  end if;
  raise notice 'PASS: nonce table service-role only';
end $$;

-- 4. Invalid nonce rejected.
do $$
begin
  begin
    perform public.claim_prime_with_nonce('aaaaaaaa-0000-0000-0000-000000000001', 'not-a-real-nonce');
    raise exception 'FAIL: invalid nonce accepted';
  exception when others then
    if sqlerrm <> 'invalid_nonce' then raise; end if;
  end;
  raise notice 'PASS: invalid nonce rejected';
end $$;

-- 5. Expired nonce rejected (and NOT consumed).
do $$
declare v_consumed timestamptz;
begin
  insert into public.prime_claim_nonces (nonce_hash, user_id, expires_at)
  values (encode(sha256(convert_to('expired-nonce-raw', 'UTF8')), 'hex'),
          'aaaaaaaa-0000-0000-0000-000000000001', now() - interval '1 minute');
  begin
    perform public.claim_prime_with_nonce('aaaaaaaa-0000-0000-0000-000000000001', 'expired-nonce-raw');
    raise exception 'FAIL: expired nonce accepted';
  exception when others then
    if sqlerrm <> 'expired_nonce' then raise; end if;
  end;
  select consumed_at into v_consumed from public.prime_claim_nonces
  where nonce_hash = encode(sha256(convert_to('expired-nonce-raw', 'UTF8')), 'hex');
  if v_consumed is not null then raise exception 'FAIL: expired nonce was consumed'; end if;
  raise notice 'PASS: expired nonce rejected and unconsumed';
end $$;

-- 6. User-mismatched nonce rejected.
do $$
begin
  insert into public.prime_claim_nonces (nonce_hash, user_id, expires_at)
  values (encode(sha256(convert_to('mismatch-nonce-raw', 'UTF8')), 'hex'),
          'aaaaaaaa-0000-0000-0000-000000000002', now() + interval '2 minutes');
  begin
    perform public.claim_prime_with_nonce('aaaaaaaa-0000-0000-0000-000000000001', 'mismatch-nonce-raw');
    raise exception 'FAIL: user-mismatched nonce accepted';
  exception when others then
    if sqlerrm <> 'nonce_user_mismatch' then raise; end if;
  end;
  raise notice 'PASS: nonce bound to a different user rejected';
end $$;

-- 7. ATOMICITY: if the critical audit insert fails, the whole claim
--    rolls back — no membership, nonce NOT consumed.
do $$
declare v_members integer; v_consumed timestamptz;
begin
  insert into public.prime_claim_nonces (nonce_hash, user_id, expires_at)
  values (encode(sha256(convert_to('atomic-nonce-raw', 'UTF8')), 'hex'),
          'aaaaaaaa-0000-0000-0000-000000000001', now() + interval '2 minutes');

  alter table public.audit_logs rename to audit_logs_hidden;
  begin
    perform public.claim_prime_with_nonce('aaaaaaaa-0000-0000-0000-000000000001', 'atomic-nonce-raw');
    alter table public.audit_logs_hidden rename to audit_logs;
    raise exception 'FAIL: claim succeeded while audit table was unavailable';
  exception when others then
    if sqlerrm like 'FAIL:%' then
      raise;
    end if;
    alter table public.audit_logs_hidden rename to audit_logs;
  end;

  select count(*) into v_members
  from public.memberships m join public.roles r on r.id = m.role_id
  where r.key = 'prime' and m.status = 'active';
  if v_members <> 0 then raise exception 'FAIL: membership created despite audit failure'; end if;

  select consumed_at into v_consumed from public.prime_claim_nonces
  where nonce_hash = encode(sha256(convert_to('atomic-nonce-raw', 'UTF8')), 'hex');
  if v_consumed is not null then raise exception 'FAIL: nonce consumed despite rollback'; end if;

  raise notice 'PASS: audit failure rolls back membership AND nonce consumption';
end $$;

-- 8. Happy path: founder claims with the (still valid) atomic-test nonce.
do $$
declare v_membership uuid; v_audit integer; v_consumed timestamptz;
begin
  v_membership := public.claim_prime_with_nonce(
    'aaaaaaaa-0000-0000-0000-000000000001', 'atomic-nonce-raw');
  if v_membership is null then raise exception 'FAIL: claim returned null'; end if;

  select count(*) into v_audit from public.audit_logs
  where action = 'prime.claimed' and resource_id = v_membership;
  if v_audit <> 1 then raise exception 'FAIL: expected exactly 1 prime.claimed audit row'; end if;

  select consumed_at into v_consumed from public.prime_claim_nonces
  where nonce_hash = encode(sha256(convert_to('atomic-nonce-raw', 'UTF8')), 'hex');
  if v_consumed is null then raise exception 'FAIL: winning nonce not consumed'; end if;

  raise notice 'PASS: valid founder claim — membership, audit row, consumed nonce';
end $$;

-- 9. Replay of the winning nonce fails.
do $$
begin
  begin
    perform public.claim_prime_with_nonce('aaaaaaaa-0000-0000-0000-000000000001', 'atomic-nonce-raw');
    raise exception 'FAIL: replayed nonce accepted';
  exception when others then
    if sqlerrm <> 'consumed_nonce' then raise; end if;
  end;
  raise notice 'PASS: winning-nonce replay rejected';
end $$;

-- 10. Second claim (fresh nonce, different user) after PRIME exists fails.
do $$
begin
  insert into public.prime_claim_nonces (nonce_hash, user_id, expires_at)
  values (encode(sha256(convert_to('late-nonce-raw', 'UTF8')), 'hex'),
          'aaaaaaaa-0000-0000-0000-000000000002', now() + interval '2 minutes');
  begin
    perform public.claim_prime_with_nonce('aaaaaaaa-0000-0000-0000-000000000002', 'late-nonce-raw');
    raise exception 'FAIL: second claim accepted';
  exception when others then
    if sqlerrm <> 'claim_already_completed' then raise; end if;
  end;
  raise notice 'PASS: post-bootstrap claim rejected';
end $$;

-- 11. DB-level single-PRIME guarantee: direct INSERT of a second active
--     PRIME membership (bypassing the RPC entirely) must be rejected by
--     the constraint trigger.
do $$
begin
  begin
    insert into public.memberships (organization_id, business_id, profile_id, role_id, authority_level)
    select o.id, null, 'aaaaaaaa-0000-0000-0000-000000000002', r.id, 'L5'
    from public.organizations o, public.roles r
    where r.key = 'prime'
    order by o.created_at limit 1;
    raise exception 'FAIL: second active PRIME membership inserted directly';
  exception when others then
    if sqlerrm <> 'single_prime_violation' then raise; end if;
  end;
  raise notice 'PASS: constraint trigger blocks a second active PRIME membership';
end $$;

-- 12. Cleanup function removes stale nonces without touching audit_logs.
do $$
declare v_audit_before bigint; v_audit_after bigint;
begin
  update public.prime_claim_nonces set created_at = now() - interval '2 days';
  select count(*) into v_audit_before from public.audit_logs;
  perform public.cleanup_prime_claim_nonces();
  select count(*) into v_audit_after from public.audit_logs;
  if v_audit_before <> v_audit_after then
    raise exception 'FAIL: cleanup touched audit_logs';
  end if;
  if exists (
    select 1 from public.prime_claim_nonces
    where (consumed_at is not null or expires_at <= now())
  ) then
    raise exception 'FAIL: stale nonces survived cleanup';
  end if;
  raise notice 'PASS: nonce cleanup safe';
end $$;

select 'PRIME BOOTSTRAP VERIFICATION COMPLETE — all checks passed' as result;
