# TESTING — JARVIS Phase 1 Audit

## Summary

- **95 unit tests, 95 passing** (Vitest, 14 files) — no network, no live DB;
  AI providers mocked, data layer exercised through the in-memory store.
- **RLS/SQL suite**: 7 structural checks + behavioral claim-PRIME probes,
  executed against real PostgreSQL 16.13 with the Supabase-runtime harness.
- **Static gates**: `tsc --noEmit` (packages + app), ESLint (typescript-
  eslint strict-ish ruleset, no-explicit-any as error), Prettier check.
- **Build gate**: `next build` (includes app typecheck) — passing.
- **Runtime smoke** (production server, placeholder env): `/login` 200;
  unauthenticated `/`→`/login` and `/executive`→`/login` 307s; chat API
  gated by middleware; cron endpoint 401 without secret; all security
  headers present.

Run everything: `cd jarvis-core && npm run validate`.

## Test file inventory

| File | Covers |
| --- | --- |
| `packages/permissions/tests/authority.test.ts` | L0–L5 ranking, inclusive meets, total order, string validation |
| `packages/permissions/tests/policy.test.ts` | deny-by-default unknown actions; per-level allow/deny; always-approval externals even at L5; cost > financial authority ⇒ approval; permission.change gated |
| `packages/permissions/tests/agent-scope.test.ts` | business scoping, denylist-beats-allowlist, inactive agents, org-level JVS-00 |
| `packages/security/tests/security.test.ts` | key/value redaction at depth; audit event build + redaction; rate limiter window; safe vs public errors; HMAC verify + tamper + weak-secret refusal |
| `packages/shared/tests/schemas.test.ts` | executive/classification/brief schema accept + reject cases (bad business codes, confidence bounds, currency format, oversized rationale) |
| `packages/ai/tests/router.test.ts` | routing policy per kind; env-only models; unconfigured + runtime fallback; both-fail; provider listing |
| `packages/ai/tests/structured.test.ts` | JSON extraction (fences, trailing prose, braces-in-strings, none); validate; retry-once with feedback; reject after retry |
| `packages/workflows/tests/classifier.test.ts` | all five documented commands; business detection (code + name, word-boundary); external-action flagging; free-form → null; offline fallback is read-only; rules run before any router use |
| `packages/workflows/tests/tools.test.ts` | happy paths (agent task creation audited); unknown tool denial; invalid args; cross-business denial; **L1 agent update ⇒ approval created, record unmodified**; L0 user gated; rate limiting; failure capture; explicit approval requests |
| `packages/workflows/tests/orchestrator.test.ts` | offline command handling + run/audit logging; FORGE task via pipeline; brief generation; **external action ⇒ approval, never execution**; dormant VOID refusal; graceful no-provider summaries; mock-model structured response + model_usage; deterministic external gate wins even with a model present |
| `packages/reporting/tests/brief.test.ts` | six sections; meaningful-only content; one consolidated brief; idempotent upsert + deduped event; empty state = empty sections (nothing fabricated) |
| `packages/reporting/tests/notify.test.ts` | in-app adapter persistence; disabled adapters skipped; per-channel failure reporting |
| `packages/integrations/tests/integrations.test.ts` | all 7 adapters registered + disabled; honest not-connected errors; allowlist rejection |
| `apps/command-center/tests/cron-auth.test.ts` | bearer accept/reject; missing header; fail-closed on missing/weak secret |

## SQL verification (`supabase/tests/rls_verification.sql`)

1. RLS enabled on all 30 exposed tables
2. No `qual='true'` allow-all policies
3. No client write policies on the 10 server-only tables
4. `audit_logs` UPDATE and DELETE both raise (append-only)
5. Seed sanity: 9 businesses, A08 dormant/agents-disabled, 10 agents, A08-RSV inactive
6. `anon` role reads zero rows
7. Memberless authenticated JWT reads zero rows and cannot insert

Plus ad-hoc behavioral verification performed during development (recorded
in the session, reproducible with the harness): first user claims PRIME,
second claim refused, PRIME sees 9 businesses, memberless sees 0,
`prime.claimed` audit row readable by PRIME.

## What is NOT covered (honest gaps)

- No integration tests against a live Supabase project (none existed in the
  build environment) — RLS behavior beyond the SQL suite, Storage, and
  realtime are untested end-to-end.
- No browser/E2E tests (Playwright) — auth flows verified only via curl
  status/header probes.
- Server actions (`app/actions/*`) are untested directly; their risky
  logic (authz, approval transition) is dual-enforced by tested layers
  (permissions package + RLS), but action-level tests would be a sensible
  next-phase addition.
- No load/perf testing; the rate limiter is unit-tested only.
- Real provider APIs never called (by design — no keys, no fabricated
  results). Adapter request/response mapping is typed but not
  integration-verified.
