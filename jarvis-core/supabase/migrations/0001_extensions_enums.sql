-- =====================================================================
-- 0001 — Extensions and enum types
-- Foundation types used by every later migration. Idempotent.
-- =====================================================================

create extension if not exists pgcrypto;

do $$ begin
  create type public.business_status as enum ('active', 'dormant', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.authority_level as enum ('L0', 'L1', 'L2', 'L3', 'L4', 'L5');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.role_key as enum
    ('prime', 'executive', 'business_manager', 'employee', 'contractor', 'client', 'agent');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.objective_status as enum ('draft', 'active', 'at_risk', 'completed', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.project_status as enum ('planning', 'active', 'on_hold', 'completed', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.task_status as enum ('todo', 'in_progress', 'blocked', 'review', 'done', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.priority_level as enum ('P0', 'P1', 'P2', 'P3');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.risk_level as enum ('low', 'medium', 'high', 'critical');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.approval_status as enum
    ('pending', 'approved', 'rejected', 'modified', 'executed', 'failed', 'expired', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.decision_status as enum ('proposed', 'recorded', 'superseded', 'reversed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.agent_run_status as enum
    ('pending', 'running', 'completed', 'failed', 'requires_approval');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.tool_call_status as enum ('requested', 'denied', 'executed', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.document_classification as enum
    ('public', 'internal', 'confidential', 'restricted');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.document_approval_status as enum
    ('draft', 'pending_review', 'approved', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.event_status as enum ('pending', 'processing', 'completed', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.actor_type as enum ('user', 'agent', 'system');
exception when duplicate_object then null; end $$;

-- Shared trigger to maintain updated_at.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
