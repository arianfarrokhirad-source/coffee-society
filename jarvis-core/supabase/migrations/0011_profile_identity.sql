-- =====================================================================
-- 0011 — Profile identity fields (registration flow, hotfix track)
--
-- Adds the two optional identity fields the dedicated /register form
-- collects. display_name carries the name the person enters; there is
-- deliberately no separate full_name column, and deliberately no sex
-- column — neither has a documented purpose today, and an unused
-- identity column is a liability, not an option.
--
-- AGE IS NEVER STORED. date_of_birth is the only birth datum; age is
-- computed at read time. A generated column could not do this anyway:
-- GENERATED ALWAYS AS requires an IMMUTABLE expression and every age
-- calculation depends on current_date.
--
-- raw_user_meta_data is CLIENT-CONTROLLED. The signup trigger below
-- reads only display_name, phone and date_of_birth from it. It must
-- never read a role, authority level, organization, business or
-- membership from metadata: metadata cannot create permissions.
--
-- Validation is split deliberately:
--   * immutable rules (phone shape, the 1900 floor) are CHECK
--     constraints — they hold under pg_dump/restore because their truth
--     never changes;
--   * the "not in the future" rule is a TRIGGER, not a CHECK, because a
--     CHECK referencing current_date is non-immutable and PostgreSQL
--     documents that as unsupported for constraint expressions.
--
-- The validation trigger also covers profiles_update_own: an
-- authenticated user may edit their own profile, so application-side
-- validation alone would not be enough.
--
-- Idempotent. ADD CONSTRAINT has no IF NOT EXISTS, so constraints are
-- added inside guarded DO blocks.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Columns. Both optional: nullable, no default, no backfill.
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists phone         text,
  add column if not exists date_of_birth date;

comment on column public.profiles.phone is
  'Self-asserted, UNVERIFIED E.164 number. Must not be treated as verified for 2FA or account recovery without a separate verification flow.';
comment on column public.profiles.date_of_birth is
  'Birth date only. Age is derived at read time and is never stored.';

-- ---------------------------------------------------------------------
-- Immutable constraints.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.profiles'::regclass and conname = 'profiles_phone_e164'
  ) then
    alter table public.profiles
      add constraint profiles_phone_e164
      check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.profiles'::regclass and conname = 'profiles_dob_floor'
  ) then
    -- Immutable half of the range rule. The upper bound is enforced by
    -- the trigger below because it depends on the current date.
    alter table public.profiles
      add constraint profiles_dob_floor
      check (date_of_birth is null or date_of_birth > date '1900-01-01');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.profiles'::regclass and conname = 'profiles_display_name_len'
  ) then
    alter table public.profiles
      add constraint profiles_display_name_len
      check (display_name is null or pg_catalog.char_length(display_name) between 1 and 200);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Safe metadata date parsing.
--
-- A bare `raw_user_meta_data->>'date_of_birth'::date` would raise inside
-- the signup trigger on any malformed value a client chose to send, and
-- a trigger failure on auth.users aborts account creation with no user
-- row — the exact "Database error saving new user" symptom. This
-- returns null instead of raising, for ANY unusable input.
--
-- Losing an optional field is acceptable; failing account creation
-- because of an optional field is not. The application rejects bad
-- dates before signup; this is the backstop for every other caller.
-- ---------------------------------------------------------------------
-- STABLE, not IMMUTABLE: it compares against current_date, so its
-- result can change between calls. Declaring it IMMUTABLE would let the
-- planner cache a value across days and would be a lie to the optimiser.
create or replace function public.safe_parse_birth_date(p_value text)
returns date
language plpgsql
stable
set search_path = ''
as $$
declare
  v_date date;
begin
  if p_value is null or pg_catalog.btrim(p_value) = '' then
    return null;
  end if;
  begin
    v_date := pg_catalog.btrim(p_value)::date;
  exception when others then
    return null;
  end;
  -- Enforce the FULL range here, not just the 1900 floor. Anything this
  -- function lets through must also satisfy profiles_dob_floor and
  -- validate_profile_identity, or the signup insert raises and account
  -- creation is aborted by an OPTIONAL field. Returning null keeps the
  -- account and drops the unusable value.
  if v_date <= date '1900-01-01' or v_date >= current_date then
    return null;
  end if;
  return v_date;
end;
$$;

comment on function public.safe_parse_birth_date is
  'Parses client-supplied birth-date metadata. Returns null for anything malformed or out of range; never raises, so optional metadata cannot abort account creation.';

revoke all on function public.safe_parse_birth_date(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Identity validation trigger. Enforces the rules that cannot be
-- immutable CHECK constraints, on INSERT and on UPDATE — the latter
-- matters because profiles_update_own lets a user edit their own row.
--
-- Reason codes are bare identifiers, mapped to user-facing text in the
-- application (see apps/command-center/lib/auth-errors.ts); no SQL
-- detail reaches the browser.
-- ---------------------------------------------------------------------
create or replace function public.validate_profile_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.date_of_birth is not null and new.date_of_birth >= current_date then
    raise exception 'invalid_date_of_birth';
  end if;
  return new;
end;
$$;

comment on function public.validate_profile_identity is
  'Enforces the non-immutable half of the birth-date rule. A CHECK constraint cannot reference current_date.';

drop trigger if exists profiles_validate_identity on public.profiles;
create trigger profiles_validate_identity
  before insert or update on public.profiles
  for each row execute function public.validate_profile_identity();

-- ---------------------------------------------------------------------
-- Signup trigger, rebuilt to the hardening standard.
--
-- Changed from 0002: search_path is now EMPTY (was `public`), every
-- object is schema-qualified, and the optional fields are parsed
-- defensively rather than cast.
--
-- Reads exactly three keys from client-controlled metadata —
-- display_name, phone, date_of_birth. None is privilege-bearing. No
-- role, authority, organization, business or membership is read from
-- metadata, and this trigger creates no membership: PRIME remains
-- reachable only through claim_prime_with_nonce (0009).
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display_name text;
  v_phone text;
begin
  v_display_name := nullif(
    pg_catalog.btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '');
  if v_display_name is null then
    -- Fall back to the mailbox name so the profile is never nameless.
    v_display_name := pg_catalog.split_part(coalesce(new.email, ''), '@', 1);
  end if;
  v_display_name := pg_catalog.left(v_display_name, 200);

  -- A malformed phone would violate profiles_phone_e164 and abort
  -- account creation, so store it only when it already matches.
  v_phone := nullif(
    pg_catalog.btrim(coalesce(new.raw_user_meta_data ->> 'phone', '')), '');
  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    v_phone := null;
  end if;

  insert into public.profiles (id, email, display_name, phone, date_of_birth)
  values (
    new.id,
    new.email,
    nullif(v_display_name, ''),
    v_phone,
    public.safe_parse_birth_date(new.raw_user_meta_data ->> 'date_of_birth')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- RLS: unchanged, and deliberately so.
--   * No INSERT policy on profiles — handle_new_user is SECURITY
--     DEFINER owned by the table owner, so it bypasses RLS.
--   * profiles_update_own already covers the new columns; neither
--     carries privilege, so self-service editing cannot escalate.
--   * profiles_select_own / profiles_select_prime extend to the new
--     columns. This widening is deliberate: PRIME is the founder and
--     already sees every membership. Revisit if a non-PRIME role or any
--     client-facing surface ever gains profile read.
-- ---------------------------------------------------------------------
