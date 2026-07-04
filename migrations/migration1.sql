-- =====================================================================
--  Migration 1 — Questions table
--
--  WHAT this creates:
--   - questions table for visitor Q&A
--   - status flow: pending -> answered | rejected
--   - RLS: only service role can read/write (no public access)
--     Public data reaches archive via Server Components using service role.
--
--  WHY:
--   - Emails must stay private (never exposed to browser)
--   - Only admin can approve what goes on archive
--
--  Idempotent. Safe to re-run.
-- =====================================================================

create table if not exists public.questions (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  email        text not null,
  question     text not null,
  answer       text,
  status       text not null default 'pending',   -- 'pending' | 'answered' | 'rejected'
  created_at   timestamptz not null default now(),
  answered_at  timestamptz
);

create index if not exists questions_status_idx on public.questions(status);
create index if not exists questions_answered_at_idx on public.questions(answered_at desc);

alter table public.questions enable row level security;

-- No public policies. Service role (admin client) bypasses RLS by design.
-- If you ever add a public read policy, DO NOT expose the email column.

notify pgrst, 'reload schema';
