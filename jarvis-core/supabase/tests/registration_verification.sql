-- =====================================================================
-- Registration / profile identity verification (hotfix track, 0011).
--
-- Proves that client-controlled signup metadata can populate the two
-- optional identity fields, can NEVER abort account creation, and can
-- never create a membership or a permission.
--
-- Requires: local_harness.sql + migrations 0001-0011 + seed.sql.
-- Every check raises on failure, so a clean exit is the pass condition.
-- NEVER run this against a real Supabase project: it inserts into
-- auth.users, which on Supabase is owned by GoTrue.
-- =====================================================================

\set ON_ERROR_STOP on
\timing off

begin;

-- ---------------------------------------------------------------------
-- 1. Schema shape: the two optional columns exist, age does not.
-- ---------------------------------------------------------------------
do $$
declare
  v_cols text;
begin
  select string_agg(column_name, ',' order by ordinal_position) into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'profiles';

  if v_cols <> 'id,display_name,email,created_at,updated_at,phone,date_of_birth' then
    raise exception 'FAIL 1: unexpected profiles shape: %', v_cols;
  end if;

  -- Age is derived, never stored — anywhere in the schema.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and column_name in ('age', 'sex', 'full_name')
  ) then
    raise exception 'FAIL 1: a deferred/derived column was created';
  end if;
  raise notice 'PASS 1: profiles has phone + date_of_birth; no age, sex or full_name column';
end $$;

-- ---------------------------------------------------------------------
-- 2. Trigger hardening: empty search_path, security definer.
-- ---------------------------------------------------------------------
do $$
declare
  v_config text[];
  v_secdef boolean;
begin
  select proconfig, prosecdef into v_config, v_secdef
  from pg_proc where proname = 'handle_new_user' and pronamespace = 'public'::regnamespace;

  if not v_secdef then
    raise exception 'FAIL 2: handle_new_user is not SECURITY DEFINER';
  end if;
  -- PostgreSQL stores `set search_path = ''` as search_path="" .
  if v_config is null
     or not exists (
       select 1 from unnest(v_config) as c
       where c in ('search_path=', 'search_path=""')
     ) then
    raise exception 'FAIL 2: handle_new_user does not set an EMPTY search_path (got %)', v_config;
  end if;
  raise notice 'PASS 2: handle_new_user is SECURITY DEFINER with an empty search_path';
end $$;

-- ---------------------------------------------------------------------
-- 3. Happy path: valid metadata populates both optional fields.
-- ---------------------------------------------------------------------
do $$
declare
  v_id uuid := gen_random_uuid();
  v_row public.profiles%rowtype;
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_id, 'reg-ok@test.local',
          '{"display_name":"Ada Lovelace","phone":"+447700900123","date_of_birth":"1990-05-04"}'::jsonb);

  select * into v_row from public.profiles where id = v_id;
  if not found then raise exception 'FAIL 3: no profile row created'; end if;
  if v_row.display_name <> 'Ada Lovelace' then
    raise exception 'FAIL 3: display_name is %, expected the entered name', v_row.display_name;
  end if;
  if v_row.phone <> '+447700900123' then raise exception 'FAIL 3: phone not stored'; end if;
  if v_row.date_of_birth <> date '1990-05-04' then raise exception 'FAIL 3: dob not stored'; end if;
  raise notice 'PASS 3: valid metadata populates display_name, phone and date_of_birth';
end $$;

-- ---------------------------------------------------------------------
-- 4. THE CRITICAL PROPERTY: hostile or malformed optional metadata
--    must never abort account creation.
--
--    A trigger failure on auth.users is what produces "Database error
--    saving new user" with no user row — the outage this whole track
--    exists to prevent.
-- ---------------------------------------------------------------------
do $$
declare
  v_id uuid;
  v_row public.profiles%rowtype;
  v_case text;
  v_meta jsonb;
begin
  for v_case, v_meta in
    select * from (values
      ('malformed date',   '{"date_of_birth":"not-a-date"}'::jsonb),
      ('impossible date',  '{"date_of_birth":"2024-02-31"}'::jsonb),
      ('future date',      '{"date_of_birth":"2999-01-01"}'::jsonb),
      ('pre-1900 date',    '{"date_of_birth":"1800-01-01"}'::jsonb),
      ('empty date',       '{"date_of_birth":""}'::jsonb),
      ('numeric date',     '{"date_of_birth":"12345"}'::jsonb),
      ('bad phone',        '{"phone":"07700 900123"}'::jsonb),
      ('injection-ish',    '{"phone":"+1'' or 1=1--"}'::jsonb),
      ('empty metadata',   '{}'::jsonb),
      ('oversized name',   ('{"display_name":"' || repeat('x', 500) || '"}')::jsonb)
    ) as t(c, m)
  loop
    v_id := gen_random_uuid();
    begin
      insert into auth.users (id, email, raw_user_meta_data)
      values (v_id, 'hostile-' || v_id::text || '@test.local', v_meta);
    exception when others then
      raise exception 'FAIL 4: signup aborted by optional metadata (%): %', v_case, sqlerrm;
    end;

    select * into v_row from public.profiles where id = v_id;
    if not found then
      raise exception 'FAIL 4: no profile row for case %', v_case;
    end if;
    -- Unusable optional input is dropped, not stored.
    if v_case <> 'malformed date' and v_row.date_of_birth is not null
       and (v_row.date_of_birth >= current_date or v_row.date_of_birth <= date '1900-01-01') then
      raise exception 'FAIL 4: out-of-range date stored for case %', v_case;
    end if;
    if v_row.phone is not null and v_row.phone !~ '^\+[1-9][0-9]{7,14}$' then
      raise exception 'FAIL 4: malformed phone stored for case %', v_case;
    end if;
    if char_length(coalesce(v_row.display_name, '')) > 200 then
      raise exception 'FAIL 4: display_name exceeded 200 chars for case %', v_case;
    end if;
  end loop;
  raise notice 'PASS 4: 10 hostile metadata cases all created an account; none stored bad data';
end $$;

-- ---------------------------------------------------------------------
-- 5. Direct updates are still validated — profiles_update_own lets an
--    authenticated user edit their own row, so the database must not
--    rely on application validation.
-- ---------------------------------------------------------------------
do $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (v_id, 'reg-update@test.local');

  -- Future date: rejected by the trigger, not by a CHECK.
  begin
    update public.profiles set date_of_birth = current_date + 1 where id = v_id;
    raise exception 'FAIL 5: a future date_of_birth was accepted on update';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'invalid_date_of_birth' then raise; end if;
  end;

  -- Today is also refused (>= current_date).
  begin
    update public.profiles set date_of_birth = current_date where id = v_id;
    raise exception 'FAIL 5: today was accepted as a date_of_birth';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'invalid_date_of_birth' then raise; end if;
  end;

  -- Pre-1900: refused by the immutable CHECK.
  begin
    update public.profiles set date_of_birth = date '1899-12-31' where id = v_id;
    raise exception 'FAIL 5: a pre-1900 date_of_birth was accepted';
  exception when check_violation then null;
  end;

  -- Malformed phone: refused by the immutable CHECK.
  begin
    update public.profiles set phone = '07700900123' where id = v_id;
    raise exception 'FAIL 5: a non-E.164 phone was accepted';
  exception when check_violation then null;
  end;

  -- A valid edit still works.
  update public.profiles
  set date_of_birth = date '1985-11-20', phone = '+14155552671'
  where id = v_id;
  raise notice 'PASS 5: self-updates are validated in the database, valid edits still apply';
end $$;

-- ---------------------------------------------------------------------
-- 6. The birth-date rule uses a TRIGGER, not a time-dependent CHECK.
--    A CHECK referencing current_date is non-immutable and PostgreSQL
--    documents it as unsupported; it also makes dump/restore fragile.
-- ---------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  select string_agg(conname, ', ') into v_bad
  from pg_catalog.pg_constraint
  where conrelid = 'public.profiles'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ~* '(current_date|now\(\)|current_timestamp)';
  if v_bad is not null then
    raise exception 'FAIL 6: time-dependent CHECK constraint(s) present: %', v_bad;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.profiles'::regclass and tgname = 'profiles_validate_identity'
  ) then
    raise exception 'FAIL 6: profiles_validate_identity trigger missing';
  end if;
  raise notice 'PASS 6: no time-dependent CHECK; the future-date rule is a trigger';
end $$;

-- ---------------------------------------------------------------------
-- 7. Registration grants NOTHING. No membership, no role, no PRIME.
-- ---------------------------------------------------------------------
do $$
declare
  v_before bigint;
  v_after bigint;
  v_id uuid := gen_random_uuid();
begin
  select count(*) into v_before from public.memberships;

  insert into auth.users (id, email, raw_user_meta_data)
  values (v_id, 'reg-noprivs@test.local',
    -- Metadata deliberately attempts to grant itself authority.
    '{"display_name":"Escalation Attempt","role":"prime","role_key":"prime",
      "authority_level":"L5","organization_id":"00000000-0000-0000-0000-000000000001",
      "is_prime":true,"membership":{"role":"prime"}}'::jsonb);

  select count(*) into v_after from public.memberships;
  if v_after <> v_before then
    raise exception 'FAIL 7: registration created % membership row(s)', v_after - v_before;
  end if;
  if exists (select 1 from public.memberships where profile_id = v_id) then
    raise exception 'FAIL 7: a membership exists for a newly registered user';
  end if;
  if exists (
    select 1 from public.memberships m
    join public.roles r on r.id = m.role_id
    where m.profile_id = v_id and r.key = 'prime'
  ) then
    raise exception 'FAIL 7: registration granted PRIME';
  end if;
  raise notice 'PASS 7: privilege-bearing metadata granted nothing — no membership, no role, no PRIME';
end $$;

-- ---------------------------------------------------------------------
-- 8. profiles still has no INSERT policy: the trigger is the only way
--    a profile row is created.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and cmd in ('INSERT', 'ALL')
  ) then
    raise exception 'FAIL 8: an INSERT policy was added to profiles';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass) then
    raise exception 'FAIL 8: RLS disabled on profiles';
  end if;
  raise notice 'PASS 8: profiles has RLS on and no client INSERT path';
end $$;

-- ---------------------------------------------------------------------
-- 9. safe_parse_birth_date is internal and total.
-- ---------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.safe_parse_birth_date(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.safe_parse_birth_date(text)', 'EXECUTE') then
    raise exception 'FAIL 9: safe_parse_birth_date is reachable by a client role';
  end if;

  if public.safe_parse_birth_date('1990-05-04') <> date '1990-05-04' then
    raise exception 'FAIL 9: valid date not parsed';
  end if;
  for i in 1..1 loop
    if public.safe_parse_birth_date('not-a-date') is not null
       or public.safe_parse_birth_date('') is not null
       or public.safe_parse_birth_date(null) is not null
       or public.safe_parse_birth_date('2024-02-31') is not null
       or public.safe_parse_birth_date('1800-01-01') is not null then
      raise exception 'FAIL 9: unusable input was not mapped to null';
    end if;
  end loop;
  raise notice 'PASS 9: safe_parse_birth_date is ungranted, total, and null-on-unusable';
end $$;

rollback;

\echo 'REGISTRATION VERIFICATION COMPLETE — all checks passed'
