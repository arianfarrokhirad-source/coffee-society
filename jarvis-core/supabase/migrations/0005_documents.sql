-- =====================================================================
-- 0005 — Document metadata and versions.
-- Files live in Supabase Storage; these tables hold metadata only.
-- searchable_text supports basic full-text search now; an embeddings
-- column can be added later without schema breakage.
-- =====================================================================

create table if not exists public.documents (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  business_id     uuid references public.businesses(id) on delete cascade,
  title           text not null check (char_length(title) between 1 and 300),
  classification  public.document_classification not null default 'internal',
  approval_status public.document_approval_status not null default 'draft',
  owner_id        uuid references public.profiles(id) on delete set null,
  storage_bucket  text not null default 'documents',
  storage_path    text,
  mime_type       text,
  size_bytes      bigint check (size_bytes is null or size_bytes >= 0),
  current_version integer not null default 1 check (current_version >= 1),
  searchable_text text,
  status          text not null default 'active' check (status in ('active', 'archived', 'deleted')),
  uploaded_at     timestamptz,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists documents_org_idx on public.documents(organization_id);
create index if not exists documents_business_idx on public.documents(business_id);
create index if not exists documents_fts_idx on public.documents
  using gin (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(searchable_text, '')));

create table if not exists public.document_versions (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references public.documents(id) on delete cascade,
  version       integer not null check (version >= 1),
  storage_path  text,
  size_bytes    bigint check (size_bytes is null or size_bytes >= 0),
  change_note   text,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (document_id, version)
);

drop trigger if exists documents_updated_at on public.documents;
create trigger documents_updated_at before update on public.documents
  for each row execute function public.set_updated_at();
