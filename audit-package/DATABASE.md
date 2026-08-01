# DATABASE — JARVIS Phase 1 Audit

Source of truth: Supabase PostgreSQL. All DDL lives in
`jarvis-core/supabase/migrations/` (8 idempotent files, run in order), seed in
`supabase/seed/seed.sql`, verification in `supabase/tests/`.

## Migration map

| File | Contents |
| --- | --- |
| `0001_extensions_enums.sql` | `pgcrypto`; 16 enum types; shared `set_updated_at()` trigger fn |
| `0002_core_identity.sql` | organizations, businesses, profiles, roles, permissions, role_permissions, memberships; profile-on-signup trigger |
| `0003_agents.sql` | agents, agent_permissions |
| `0004_work.sql` | objectives, projects, tasks, task_dependencies, decisions, approvals, notifications |
| `0005_documents.sql` | documents, document_versions (+ GIN full-text index) |
| `0006_runs_audit.sql` | agent_runs, agent_messages, tool_calls, model_usage, audit_logs (append-only triggers), daily_briefs, system_events |
| `0007_rls.sql` | RLS helper functions, `claim_prime()`, RLS enable + all policies |
| `0008_forge_pilot.sql` | leads, clients, website_audits, proposals, website_projects, maintenance_plans (+ policies via DO loop) |

30 exposed tables total. Every table: UUID PK (`gen_random_uuid()`),
`timestamptz` timestamps, FKs with explicit `on delete` behavior, CHECK
constraints (code formats, currency `^[A-Z]{3}$`, non-negative amounts,
status vocabularies), and `updated_at` maintained by trigger.

## Integrity constraints worth auditing

- `businesses.code ~ '^A[0-9]{2}$'`, unique per organization
- `approvals`: `requested_by_agent_id IS NOT NULL OR requested_by_user_id IS NOT NULL`
- `task_dependencies`: composite PK + `task_id <> depends_on_id`
- `system_events`: unique partial index on `(organization_id, event_type, dedupe_key)`
  where dedupe_key is not null → idempotent event writes
- `daily_briefs`: unique `(organization_id, brief_date)` → one brief per day, upserted
- `agents.max_financial_authority >= 0`; seeded to **0** for every agent
- `audit_logs`: BEFORE UPDATE/DELETE triggers raise unconditionally —
  append-only **even for the service role** (RLS bypass does not bypass
  triggers). Retention pruning would require dropping the trigger in a
  migration, which is itself auditable.

## Seed (`seed/seed.sql`)

Idempotent (`on conflict do nothing` throughout). Creates:
- 1 organization (`atlas-holdings`)
- 7 roles with default authority (prime L5 … client L0)
- 19 permission keys + role_permission grants
- 9 businesses A00–A08; **A08 VOID: status='dormant', agents_enabled=false**
- 10 agents (JVS-00 org-level; one per business). All L1 except A08-RSV (L0,
  inactive). All `max_financial_authority = 0`. Explicit allowed/prohibited
  action arrays (e.g. A04-CFO prohibits `trading`, `money_transfer`).

No personal data and no secrets are seeded. PRIME is assigned at runtime via
`claim_prime()` (see SECURITY.md), never by seed.

## RLS model (0007)

Helper functions are `SECURITY DEFINER`, `STABLE`, `search_path = public`:

- `is_prime(org)` — active membership with role `prime`
- `my_org_ids()` — orgs with any active membership
- `has_business_access(business)` — org-wide roles (prime/executive) or
  business-scoped membership; **explicitly excludes role `client`**
- `has_org_wide_access(org)` / `can_access_scoped(org, business)` — org-level
  rows (business_id NULL) visible only to org-wide roles

Policy summary (verify against `0007_rls.sql` / `0008` DO loop):

| Table group | select | insert | update | delete |
| --- | --- | --- | --- | --- |
| organizations | members | — (server) | PRIME | — |
| businesses | scoped/PRIME | PRIME | PRIME | PRIME |
| profiles | own + PRIME(co-org) | trigger | own | — |
| roles/permissions/role_permissions | any authenticated (reference data) | — | — | — |
| memberships | own + PRIME | PRIME | PRIME | PRIME |
| agents/agent_permissions | scoped/PRIME | PRIME | PRIME | PRIME |
| objectives/projects/tasks/deps | scoped | scoped | scoped | PRIME |
| decisions | scoped | scoped | PRIME | PRIME |
| approvals | scoped/PRIME | own request + scoped | **PRIME only** | — |
| notifications | recipient | — (server) | recipient | — |
| documents/versions | scoped; `restricted` → PRIME only | scoped | scoped (restricted→PRIME) | PRIME |
| agent_runs/messages/tool_calls | scoped read-only | — (server) | — | — |
| model_usage / audit_logs / daily_briefs / system_events | PRIME read-only | — (server) | — | — |
| FORGE pilot tables | scoped | scoped | scoped | PRIME |

"— (server)" = no policy exists; only the service role (RLS bypass) can
write, and only from server code.

## Verification

`supabase/tests/rls_verification.sql` (run after migrations + seed):
1. RLS enabled on all 30 tables
2. Zero allow-all (`qual='true'`) policies
3. Zero client write policies on the 10 server-only tables
4. audit_logs UPDATE and DELETE both blocked
5. Seed sanity (9 businesses, VOID dormant, 10 agents, A08-RSV inactive)
6. `anon` reads zero rows
7. Authenticated user with no membership reads zero rows / cannot insert

`supabase/tests/local_harness.sql` emulates the Supabase runtime (auth
schema, `auth.uid()` from `request.jwt.claims`, anon/authenticated/
service_role roles) so the entire chain runs on plain PostgreSQL 16.
**Never run the harness against a real Supabase project.**

Verified during development: all 8 migrations + seed + the full verification
suite pass on PostgreSQL 16.13; behavioral checks confirmed `claim_prime()`
is one-time, PRIME sees 9 businesses, a memberless user sees 0, and the
claim is audit-logged.

## TypeScript access layer

- `packages/database/src/types.ts` — hand-maintained row types (no codegen
  dependency; regenerate with Supabase CLI if drift becomes an issue)
- `packages/database/src/store.ts` — `JarvisStore` interface (the only seam
  the orchestrator/reporting layers use)
- `store-supabase.ts` — production impl (service role; assumes caller did
  permission checks — by design, so authorization lives in exactly one place)
- `store-memory.ts` — seed-mirroring in-memory impl used by tests
