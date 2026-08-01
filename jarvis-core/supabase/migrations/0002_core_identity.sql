-- =====================================================================
-- 0002 — Organizations, businesses, profiles, memberships, roles,
--        permissions and role_permissions.
-- =====================================================================

create table if not exists public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 200),
  slug        text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  status      text not null default 'active' check (status in ('active', 'archived')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.businesses (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code            text not null check (code ~ '^A[0-9]{2}$'),
  name            text not null check (char_length(name) between 1 and 120),
  description     text,
  status          public.business_status not null default 'active',
  agents_enabled  boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, code)
);

create index if not exists businesses_org_idx on public.businesses(organization_id);

-- Profiles mirror auth.users. Created by trigger on signup.
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  email        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.roles (
  id                      uuid primary key default gen_random_uuid(),
  key                     public.role_key not null unique,
  name                    text not null,
  description             text,
  default_authority_level public.authority_level not null default 'L0',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create table if not exists public.permissions (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique check (key ~ '^[a-z0-9_.]{2,80}$'),
  description text,
  min_authority public.authority_level not null default 'L1',
  created_at  timestamptz not null default now()
);

create table if not exists public.role_permissions (
  role_id       uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (role_id, permission_id)
);

-- business_id null means organization-wide membership (PRIME, executives).
create table if not exists public.memberships (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  business_id     uuid references public.businesses(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  role_id         uuid not null references public.roles(id) on delete restrict,
  authority_level public.authority_level not null default 'L0',
  status          text not null default 'active' check (status in ('active', 'suspended', 'revoked')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, profile_id, business_id, role_id)
);

create index if not exists memberships_profile_idx on public.memberships(profile_id);
create index if not exists memberships_org_idx on public.memberships(organization_id);
create index if not exists memberships_business_idx on public.memberships(business_id);

drop trigger if exists organizations_updated_at on public.organizations;
create trigger organizations_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();
drop trigger if exists businesses_updated_at on public.businesses;
create trigger businesses_updated_at before update on public.businesses
  for each row execute function public.set_updated_at();
drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
drop trigger if exists roles_updated_at on public.roles;
create trigger roles_updated_at before update on public.roles
  for each row execute function public.set_updated_at();
drop trigger if exists memberships_updated_at on public.memberships;
create trigger memberships_updated_at before update on public.memberships
  for each row execute function public.set_updated_at();

-- Auto-create a profile row whenever an auth user is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
