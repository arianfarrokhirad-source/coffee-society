# AUDIT_HANDOFF — JARVIS Phase 1 Baseline

**Checkpoint tag:** `jarvis-phase-1-audit`
**Branch:** `claude/jarvis-phase-1-5lq25b`
**Baseline commit (pre-checkpoint):** `49406184d4d95b7797424f6890fc3ff00c223418`
(the checkpoint commit adding this file is the tag target; verify with
`git rev-parse jarvis-phase-1-audit`)
**Status:** DEVELOPMENT FROZEN pending independent audit. Nothing discovered
during this checkpoint was fixed; everything is documented below.

A deeper ten-document audit set with a SHA-256 file manifest exists in
`/audit-package` (and `audit-package.zip`). This file is the single-page
hand-off summary.

---

## 1. Current architecture

- Monorepo `jarvis-core/` (npm workspaces, TypeScript strict, packages
  consumed as source via Next `transpilePackages`).
- `apps/command-center`: Next.js 15 App Router UI, server actions, two API
  routes, auth middleware.
- Packages: `shared` (types/Zod schemas), `permissions` (L0–L5 authority,
  deny-by-default action policy, agent scope), `security` (redaction, audit
  events, rate limit, safe errors, HMAC), `database` (typed rows,
  `JarvisStore` seam: Supabase + in-memory), `ai` (Anthropic/OpenAI fetch
  adapters, env-configured router, structured output), `workflows`
  (classifier, 10-tool pipeline, JVS-00 orchestrator), `reporting` (daily
  brief, notification adapters), `integrations` (7 disabled adapters),
  `ui`; `agents/` (constitution + versioned role cards).
- `supabase/`: 8 idempotent migrations (30 tables), seed (A00–A08 + 10
  agents), RLS verification suite, local PG16 harness.
- Two data paths: user path via anon-key client under RLS; orchestrator
  path via service role behind application permission checks, fully
  audited. The repo root also contains the unrelated legacy "Coffee
  Society" app (see §8 assumptions).

## 2. Implemented features

Auth (Supabase email/password, middleware gating, one-time atomic
`claim_prime()`); businesses A00–A08 seeded (A08 dormant, agents disabled);
objectives/projects/tasks/decisions CRUD under RLS; approvals with
PRIME-only resolution (dual-enforced app + RLS); in-app notifications
P0–P3; agent registry; JARVIS chat (5 deterministic commands work with zero
AI keys; model-backed free-form when keys exist); AI router with
cross-provider fallback and Zod-validated structured output; daily PRIME
brief (manual + bearer-authenticated cron endpoint, idempotent per day);
append-only audit log (DB-level, service-role included); tool pipeline that
converts restricted/over-authority/costly requests into approval records;
executive/business dashboards with honest empty states; security headers +
CSP; 95 passing unit tests; SQL RLS verification suite.

## 3. Partially implemented

- Documents: schema, classification, versioning, RLS, list/search UI exist;
  **no upload/Storage wiring**.
- FORGE pilot: 6 domain tables with RLS exist; **no UI**.
- `task_dependencies`: schema + RLS; **no UI**.
- `review` model route: plumbed in router; **no workflow uses it**.
- `system_events`: emitted idempotently; **no consumer/worker**.
- `agent_messages` table exists; transcripts are **not** written (summaries
  only).
- Notifications: in-app only; delivery adapter interface exists, no
  external channel adapters.

## 4. Unimplemented (by design in Phase 1)

Approval executors (approving records the decision; nothing runs), any
external side effect (email/publishing/messaging), client portal, financial
execution of any kind, live third-party integrations (all 7 adapters
disabled), embeddings/vector search, streaming chat, multi-organization
support, 2FA/SSO.

## 5. Known security weaknesses (accepted/residual)

1. CSP includes `script-src 'unsafe-inline'` (Next bootstrapping without
   nonces) — acceptable for a private noindex tool.
2. Rate limiting is in-memory per serverless instance (interface allows a
   distributed impl).
3. `JarvisStore` performs no authorization itself; every new call site of
   `getStore()`/`createServiceClient()` must be preceded by permission
   checks — review-discipline risk.
4. Public signups enabled by default (memberless accounts see nothing;
   disable after onboarding is documented, not enforced).
5. Audit `metadata` (IP/user-agent) not populated by current call sites
   (column exists).
6. No 2FA. Password minimum is 10 characters.
7. `JARVIS_ENCRYPTION_KEY` reserved but unused (no at-rest encryption of
   integration config yet — no integration config exists yet either).
8. Legacy root app uses a single shared `ADMIN_PASSWORD` cookie and
   service-role reads — pre-existing, out of JARVIS scope, unchanged.

## 6. Known bugs

- None currently known in JARVIS code paths (95/95 tests green; clean-state
  validation passed at this checkpoint). Historical fixes are in git
  history (e.g. root-tsconfig sweep breaking the Vercel root build; legacy
  app build-time env dependence).
- Watch-item, not verified as a bug: `Suggested follow-up` — classifier
  business detection is first-match keyword-based; messages naming two
  businesses route to the first mentioned (explicit selection overrides).

## 7. Technical debt

Hand-maintained DB row types (no codegen); no integration tests against a
live Supabase project; no browser/E2E tests; server actions untested
directly (logic dual-enforced by tested layers); no down-migrations
(rollback = restore backup); Vercel Cron cannot natively send the required
POST+bearer for the brief endpoint (external scheduler needed); monorepo
shares a repository with the legacy app.

## 8. Assumptions

- Single organization, single founder (PRIME); first authenticated user to
  call `claim_prime()` is the legitimate founder.
- Supabase project env vars are configured wherever the app runs; the
  legacy root app no longer *builds* against env but still *runs* against
  it.
- The Vercel project observed on PR #1 builds the repository ROOT (legacy
  app); JARVIS deploys as a separate project rooted at
  `jarvis-core/apps/command-center`.
- Local PG16 + `supabase/tests/local_harness.sql` is an accepted stand-in
  for Supabase in DB verification (never run the harness against real
  Supabase).
- EUR default currency; UTC dates for briefs.

## 9. Manual setup steps

1. Supabase project → run `supabase/migrations/0001…0008` in order → run
   `supabase/seed/seed.sql` → run `supabase/tests/rls_verification.sql`
   (expect `RLS VERIFICATION COMPLETE`).
2. Copy `jarvis-core/.env.example` → `jarvis-core/apps/command-center/.env.local`,
   fill Supabase values (AI keys + `JARVIS_MODEL_*` optional).
3. `cd jarvis-core && npm ci && npm run dev`.
4. Sign up at `/login`, click **Claim PRIME** on `/executive` (one-time).
5. Optional: private Storage bucket `documents`; disable public signups;
   Vercel deployment per `jarvis-core/docs/setup/vercel.md`.

## 10. Exact validation commands (all run at this checkpoint, all passing)

```bash
cd jarvis-core
rm -rf node_modules apps/command-center/.next
npm ci            # 275 packages
npm run lint      # eslint . → exit 0
npm run typecheck # tsc --noEmit (packages) + tsc --noEmit (app) → exit 0
npm run test      # vitest → 14 files, 95/95 passed
npm run build     # next build → exit 0

# Database chain on a FRESH plain PostgreSQL 16.13 instance:
psql -v ON_ERROR_STOP=1 \
  -f supabase/tests/local_harness.sql \
  -f supabase/migrations/0001_extensions_enums.sql \
  -f supabase/migrations/0002_core_identity.sql \
  -f supabase/migrations/0003_agents.sql \
  -f supabase/migrations/0004_work.sql \
  -f supabase/migrations/0005_documents.sql \
  -f supabase/migrations/0006_runs_audit.sql \
  -f supabase/migrations/0007_rls.sql \
  -f supabase/migrations/0008_forge_pilot.sql \
  -f supabase/seed/seed.sql \
  -f supabase/tests/rls_verification.sql
# → 8/8 checks PASS, "RLS VERIFICATION COMPLETE — all checks passed"
```

Toolchain at checkpoint: Node v22.22.2, npm 10.9.7, PostgreSQL 16.13
(Ubuntu). Supabase CLI: **not installed** — migrations are applied via SQL
editor/psql; the CLI is not required by any workflow in this repo.

## 11. Recommended next step

Independent audit of this frozen baseline, prioritizing: (1) RLS policies
vs. the access matrix in `audit-package/DATABASE.md`, (2) every
service-role call site for preceding permission checks, (3) the tool
pipeline's approval-creation invariants, (4) the claim-PRIME bootstrap.
After sign-off, resume with Phase 2 item 1 (approval executors) per
`audit-package/NEXT_PHASE.md`.
