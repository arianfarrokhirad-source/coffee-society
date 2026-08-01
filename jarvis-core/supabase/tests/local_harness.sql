-- =====================================================================
-- Local test harness: minimal emulation of the Supabase runtime so the
-- migrations + seed + rls_verification.sql can run against a plain
-- PostgreSQL 16 instance (CI / local verification without Supabase).
-- NEVER run this against a real Supabase project.
-- =====================================================================

do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb default '{}',
  created_at timestamptz not null default now()
);

-- Supabase resolves auth.uid() from the request JWT; locally we read the
-- same request.jwt.claims GUC that PostgREST would set.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
$$;

grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;
