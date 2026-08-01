-- =====================================================================
-- 0009 — Secure PRIME bootstrap (Phase 1.1, commit 1)
--
-- Replaces first-user-wins claim_prime() with a nonce-gated atomic RPC.
-- The raw setup token NEVER reaches PostgreSQL: the server action
-- validates it against a server-only env var (constant-time) and then
-- mints a short-lived, single-use, user-bound nonce. Only the nonce
-- crosses into the database.
--
-- Advisory lock namespace (reserved, documented):
--   classid 742617 ('JARVIS' application namespace)
--   objid        1 (PRIME bootstrap — reserved exclusively for this)
--
-- Audit guarantees terminology: audit_logs is append-only at the
-- application/database-role level and deletion-resistant for
-- application roles. It is NOT tamper-proof; hash chaining (later
-- commit) is required before calling it tamper-evident.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Nonce table. Stores hashes only. RLS enabled with ZERO policies:
-- exclusively service-role accessible. Rows are ephemeral operational
-- records (the durable security record is audit_logs), so profile
-- cascade is acceptable and documented.
-- ---------------------------------------------------------------------
create table if not exists public.prime_claim_nonces (
  id          uuid primary key default gen_random_uuid(),
  nonce_hash  text not null unique check (nonce_hash ~ '^[0-9a-f]{64}$'),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  consumed_at timestamptz
);

create index if not exists prime_claim_nonces_user_idx on public.prime_claim_nonces(user_id);
create index if not exists prime_claim_nonces_expires_idx on public.prime_claim_nonces(expires_at);

alter table public.prime_claim_nonces enable row level security;
-- No policies: no client role can read or write nonce rows.

-- Supports the persistent denial-count rate limit in the server action.
create index if not exists audit_logs_actor_action_time_idx
  on public.audit_logs (actor_id, action, created_at desc);

-- ---------------------------------------------------------------------
-- Database-level single-PRIME guarantee (defense independent of the
-- advisory lock and of any application code path). A constraint trigger
-- serializes on the reserved advisory lock and rejects a second active
-- PRIME membership in the same organization. Partial unique index is
-- not usable here because the prime role id is not a constant.
-- ---------------------------------------------------------------------
create or replace function public.enforce_single_prime_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_prime boolean;
begin
  select (r.key = 'prime') into v_is_prime
  from public.roles r
  where r.id = new.role_id;

  if coalesce(v_is_prime, false) and new.status = 'active' then
    -- Serialize with every other path that could create a PRIME row.
    perform pg_catalog.pg_advisory_xact_lock(742617, 1);
    if exists (
      select 1
      from public.memberships m
      join public.roles r2 on r2.id = m.role_id
      where m.organization_id = new.organization_id
        and m.id <> new.id
        and m.status = 'active'
        and r2.key = 'prime'
    ) then
      raise exception 'single_prime_violation';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_single_prime_membership() from public;

drop trigger if exists memberships_single_prime on public.memberships;
create trigger memberships_single_prime
  before insert or update on public.memberships
  for each row execute function public.enforce_single_prime_membership();

-- ---------------------------------------------------------------------
-- Drop the legacy first-user-wins function. There is deliberately no
-- downgrade path that restores it; rollback requires a secure
-- replacement (see docs/security/security-model.md).
-- ---------------------------------------------------------------------
drop function if exists public.claim_prime();

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'claim_prime'
  ) then
    raise exception 'legacy claim_prime() still exists after drop';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Atomic claim RPC.
--   SECURITY DEFINER with EMPTY search_path; every object fully
--   qualified; no dynamic SQL. EXECUTE revoked from PUBLIC/anon/
--   authenticated and granted ONLY to service_role — browsers cannot
--   call it, and even service-role calls fail without a valid nonce.
--   The claimant identity is DERIVED FROM THE NONCE ROW; p_expected_user
--   is only a cross-check (reduces trusted input surface).
--
-- Internal failure reason codes (raised as exception messages; the
-- server maps them to audit reasons and returns one generic message to
-- the browser): invalid_nonce, expired_nonce, consumed_nonce,
-- nonce_user_mismatch, profile_missing, claim_already_completed.
-- ---------------------------------------------------------------------
create or replace function public.claim_prime_with_nonce(p_expected_user uuid, p_nonce text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_nonce public.prime_claim_nonces%rowtype;
  v_org uuid;
  v_role uuid;
  v_membership uuid;
begin
  -- 1. Serialize all claim attempts (reserved JARVIS lock 742617/1).
  perform pg_catalog.pg_advisory_xact_lock(742617, 1);

  -- 2. Retrieve and lock the nonce row by hash (single-use semantics).
  v_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(p_nonce, 'UTF8')), 'hex');

  select * into v_nonce
  from public.prime_claim_nonces
  where nonce_hash = v_hash
  for update;

  if not found then
    raise exception 'invalid_nonce';
  end if;
  if v_nonce.consumed_at is not null then
    raise exception 'consumed_nonce';
  end if;
  if v_nonce.expires_at <= pg_catalog.now() then
    raise exception 'expired_nonce';
  end if;
  if v_nonce.user_id is distinct from p_expected_user then
    raise exception 'nonce_user_mismatch';
  end if;

  -- 3. Derive the claimant from the nonce row and verify provisioning.
  if not exists (select 1 from public.profiles pr where pr.id = v_nonce.user_id) then
    raise exception 'profile_missing';
  end if;

  select o.id into v_org
  from public.organizations o
  order by o.created_at
  limit 1;
  if v_org is null then
    raise exception 'organization_not_seeded';
  end if;

  select r.id into v_role from public.roles r where r.key = 'prime';
  if v_role is null then
    raise exception 'prime_role_not_seeded';
  end if;

  -- 4. Verify no active PRIME exists (also enforced by the constraint
  --    trigger on insert — two independent layers).
  if exists (
    select 1
    from public.memberships m
    join public.roles r on r.id = m.role_id
    where m.organization_id = v_org and m.status = 'active' and r.key = 'prime'
  ) then
    raise exception 'claim_already_completed';
  end if;

  -- 5. Consume the nonce, create the membership, write the CRITICAL
  --    audit row — one transaction. Any failure rolls back everything:
  --    the nonce is not consumed unless membership + audit both commit.
  update public.prime_claim_nonces
  set consumed_at = pg_catalog.now()
  where id = v_nonce.id;

  insert into public.memberships
    (organization_id, business_id, profile_id, role_id, authority_level)
  values
    (v_org, null, v_nonce.user_id, v_role, 'L5')
  returning id into v_membership;

  insert into public.audit_logs
    (organization_id, actor_type, actor_id, action, resource_type, resource_id, metadata)
  values
    (v_org, 'user', v_nonce.user_id, 'prime.claimed', 'membership', v_membership,
     pg_catalog.jsonb_build_object('method', 'setup_token_nonce'));

  return v_membership;
end;
$$;

revoke all on function public.claim_prime_with_nonce(uuid, text) from public;
revoke all on function public.claim_prime_with_nonce(uuid, text) from anon;
revoke all on function public.claim_prime_with_nonce(uuid, text) from authenticated;
grant execute on function public.claim_prime_with_nonce(uuid, text) to service_role;

-- ---------------------------------------------------------------------
-- Optional maintenance: purge expired/consumed nonces older than a day.
-- Service-role only. Does not touch audit_logs (the durable record).
-- ---------------------------------------------------------------------
create or replace function public.cleanup_prime_claim_nonces()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.prime_claim_nonces
  where (consumed_at is not null or expires_at <= pg_catalog.now())
    and created_at < pg_catalog.now() - interval '1 day';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.cleanup_prime_claim_nonces() from public;
revoke all on function public.cleanup_prime_claim_nonces() from anon;
revoke all on function public.cleanup_prime_claim_nonces() from authenticated;
grant execute on function public.cleanup_prime_claim_nonces() to service_role;
