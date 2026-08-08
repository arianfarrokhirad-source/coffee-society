<!--
Type: manual
Canonical for: nothing — supabase/migrations/ is canonical
Update when: migration conventions, RLS helpers or canonical sources change
Owner: PRIME
Budget: Tiny (~150 lines)
-->

# Database context

Load for: migrations, RLS, schema changes, store implementations.
**Canonical: `supabase/migrations/` — never this file.**

## Shape

31 tables across 9 idempotent migrations. UUID PKs (`gen_random_uuid()`),
`timestamptz` everywhere, explicit FK delete behaviour, CHECK constraints on
codes/currency/amounts, `updated_at` via the shared `set_updated_at()` trigger.

| Migration | Contents                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------- |
| `0001`    | extensions, 16 enums, `set_updated_at()`                                                                            |
| `0002`    | organizations, businesses, profiles, roles, permissions, role_permissions, memberships, signup trigger              |
| `0003`    | agents, agent_permissions                                                                                           |
| `0004`    | objectives, projects, tasks, task_dependencies, decisions, approvals, notifications                                 |
| `0005`    | documents, document_versions (GIN full-text index)                                                                  |
| `0006`    | agent_runs, agent_messages, tool_calls, model_usage, audit_logs (append-only triggers), daily_briefs, system_events |
| `0007`    | RLS helpers, RLS enable + policies                                                                                  |
| `0008`    | FORGE pilot: leads, clients, website_audits, proposals, website_projects, maintenance_plans                         |
| `0009`    | PRIME bootstrap: prime_claim_nonces, single-PRIME trigger, `claim_prime_with_nonce()`, drops legacy `claim_prime()` |

## RLS model

Helpers in `0007` (all `SECURITY DEFINER`, `STABLE`): `is_prime(org)`,
`my_org_ids()`, `has_business_access(business)` — **excludes the `client`
role** — `has_org_wide_access(org)`, `can_access_scoped(org, business)`.

- Org-wide roles (`prime`, `executive`) see org-level rows (`business_id IS NULL`).
- Business-scoped roles see only their businesses.
- Run/log/brief/event tables: **read-only** for scoped members; no client write
  policies exist — only the service role writes them.
- `audit_logs`: PRIME read-only; UPDATE/DELETE blocked by trigger for **every**
  role including `service_role`. Append-only, deletion-resistant — _not_
  tamper-proof, _not_ yet tamper-evident.
- `prime_claim_nonces`: RLS enabled with **zero policies** (service-role only).

## Rules for changing the database

1. **Idempotent migrations only** (`if not exists`, `drop … if exists` before
   create). They are applied by hand in the Supabase SQL editor today.
2. **Never edit an applied migration** — add a new numbered one.
3. New table ⇒ RLS enabled **and** policies **and** an entry in
   `supabase/tests/rls_verification.sql` (it asserts an exact table count).
4. `SECURITY DEFINER` functions: pin `search_path` (prefer `''` with fully
   qualified objects), no dynamic SQL, revoke from `PUBLIC`/`anon`/
   `authenticated`, grant narrowly.
5. Nothing destructive. No `DROP TABLE`, no data rewrites; no down-migrations
   exist — rollback is restore-from-backup.
6. Verify on a fresh PostgreSQL 16 with `supabase/tests/local_harness.sql`
   (emulates `auth.uid()`, `anon`/`authenticated`/`service_role`).
   **Never run the harness against real Supabase.**

## Canonical sources (today, honestly)

| Concern                    | Canonical now                                                                                                        | Changing in        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Schema                     | `supabase/migrations/`                                                                                               | —                  |
| Row TypeScript types       | hand-written `packages/database/src/types.ts`                                                                        | commit 7 (codegen) |
| Business/agent definitions | `supabase/seed/seed.sql` — but duplicated in `shared/src/constants.ts` and `store-memory.ts`                         | commit 6           |
| Authorization policy       | `ACTION_POLICIES` in code; the `permissions`/`role_permissions`/`agent_permissions` tables are **seeded but unread** | commit 5           |

## Known issues in the schema

- No composite FK `(organization_id, business_id) → businesses` — a row can
  reference a business from another organization (commit 3).
- `audit_logs.business_id` has no FK (commit 3).
- RLS helpers are evaluated **per row**; the initplan-caching pattern is not
  applied yet (commit 4).
- Enum inconsistency: core tables use PG enums, FORGE tables use `text + CHECK`.
- `profiles.email` is copied at signup and never re-synced.

## Verification

```bash
psql -f supabase/tests/local_harness.sql \
     -f supabase/migrations/0001…0009 -f supabase/seed/seed.sql \
     -f supabase/tests/rls_verification.sql \
     -f supabase/tests/prime_bootstrap_verification.sql
./supabase/tests/race_prime_claim.sh     # needs two backends
```
