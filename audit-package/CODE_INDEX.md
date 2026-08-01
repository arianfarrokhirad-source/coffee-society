# CODE_INDEX — Every JARVIS source file, one line each

Paths relative to the repository root. The legacy Coffee Society app at the
repo root (`app/`, `components/`, `lib/`, `migrations/migration1.sql`, root
config files) is pre-existing, untouched, and out of audit scope.

## Workspace root (`jarvis-core/`)

| File | Purpose |
| --- | --- |
| `package.json` | npm workspaces root; dev/build/typecheck/lint/test/validate scripts |
| `package-lock.json` | pinned dependency tree (audit reproducibility) |
| `tsconfig.base.json` | strict TS baseline shared by all workspaces |
| `tsconfig.json` | packages+agents typecheck project |
| `vitest.config.ts` | test discovery across packages, agents, app |
| `eslint.config.mjs` | flat config, typescript-eslint, no-explicit-any as error |
| `.prettierrc.json` / `.prettierignore` | formatting rules |
| `.env.example` | placeholder env vars with exposure notes (no secrets) |
| `.gitignore` | excludes node_modules, .next, env files, tsbuildinfo |
| `README.md` | features, honest limitations, setup, commands, layout |

## `packages/shared` — canonical types & schemas

| File | Purpose |
| --- | --- |
| `src/constants.ts` | business codes A00–A08, agent codes, business→agent map, authority levels, roles, priorities, risk/approval statuses, provider names |
| `src/schemas.ts` | Zod: executiveResponseSchema, taskClassificationSchema, dailyBriefContentSchema (bounded, no chain-of-thought) |
| `src/result.ts` | `Result<T,E>` discriminated union (`ok`/`err`) |
| `src/index.ts` | barrel |
| `tests/schemas.test.ts` | schema accept/reject cases |

## `packages/permissions` — the authority engine

| File | Purpose |
| --- | --- |
| `src/authority.ts` | L0–L5 ranking, inclusive `meetsAuthority`, compare, validate |
| `src/policy.ts` | ACTION_POLICIES map; UNKNOWN_ACTION_POLICY (deny-by-default); `checkApproval()` (authority + always-approval + financial gates) |
| `src/agent-scope.ts` | `canAgentAct()` — active/denylist/business-scope/allowlist enforcement |
| `src/index.ts` | barrel |
| `tests/authority.test.ts`, `tests/policy.test.ts`, `tests/agent-scope.test.ts` | see TESTING.md |

## `packages/security` — cross-cutting controls

| File | Purpose |
| --- | --- |
| `src/redact.ts` | key- and value-pattern secret redaction, depth-capped |
| `src/audit.ts` | `buildAuditEvent()` — validated, redacted, persistable audit events |
| `src/rate-limit.ts` | `RateLimiter` interface + in-memory sliding window |
| `src/safe-error.ts` | generic user-facing errors; `PublicError` allowlist |
| `src/webhooks.ts` | HMAC-SHA256 webhook verifier (timing-safe) |
| `src/index.ts` | barrel |
| `tests/security.test.ts` | all of the above |

## `packages/database` — persistence seam

| File | Purpose |
| --- | --- |
| `src/types.ts` | hand-maintained typed rows for all consumed tables |
| `src/clients.ts` | env reader + `createServiceClient()` (browser-guarded, server-only) |
| `src/audit.ts` | `writeAuditLog()` — audit persistence, failures surfaced |
| `src/store.ts` | `JarvisStore` interface + all input/output types (the only data seam orchestration uses) |
| `src/store-supabase.ts` | production impl (service role; deliberately authorization-free — checks happen upstream) |
| `src/store-memory.ts` | seed-mirroring in-memory impl for tests/offline |
| `src/index.ts` | barrel |

## `packages/ai` — provider abstraction

| File | Purpose |
| --- | --- |
| `src/types.ts` | provider-neutral interfaces + AIProviderError |
| `src/providers/anthropic.ts` | Messages API adapter (fetch, lazy key) |
| `src/providers/openai.ts` | Chat Completions adapter (fetch, base-URL override) |
| `src/router.ts` | route-kind policy, env-only models, cross-provider fallback |
| `src/structured.ts` | JSON extraction + Zod validation + single feedback retry |
| `src/index.ts` | barrel |
| `tests/router.test.ts`, `tests/structured.test.ts` | mocked-provider coverage |

## `agents/` — prompts (versioned) & composition

| File | Purpose |
| --- | --- |
| `src/constitution.ts` | Master Constitution v1 (single source) |
| `src/index.ts` | role-card registry + `composePrompt()` layering |
| `jvs/role-card.ts` | JVS-00 orchestrator card |
| `atlas|forge|signal|vector|oracle|tempo|echo|academy|void/role-card.ts` | per-business agent cards (ORACLE bans trading; VOID refuses all) |
| `package.json` | workspace manifest |

## `packages/workflows` — JVS-00

| File | Purpose |
| --- | --- |
| `src/classifier.ts` | deterministic command rules, business detection, model-assisted refinement, safe fallback |
| `src/tools.ts` | 10 internal tools + the enforcement pipeline (validate→scope→policy→approval→execute→log) |
| `src/orchestrator.ts` | `runJarvis()` — the 12-step run, actor-authority rules, reply formatting |
| `src/index.ts` | barrel |
| `tests/classifier.test.ts`, `tests/tools.test.ts`, `tests/orchestrator.test.ts` | see TESTING.md |

## `packages/reporting` — briefs & notifications

| File | Purpose |
| --- | --- |
| `src/brief.ts` | `composeBrief()` (pure, six sections, meaningful-only) + `generateDailyBrief()` (gather→upsert→event→P2 notification) |
| `src/notify.ts` | `NotificationDeliveryAdapter` interface, in-app adapter, fan-out dispatch |
| `src/index.ts` | barrel |
| `tests/brief.test.ts`, `tests/notify.test.ts` | composition, idempotency, empty-state honesty, channel dispatch |

## `packages/integrations` — external adapter contract

| File | Purpose |
| --- | --- |
| `src/adapter.ts` | `IntegrationAdapter` contract + disabled-placeholder factory |
| `src/registry.ts` | 7 adapters (composio, firecrawl, relay, manus, hedra, lindy, obsidian) — all disabled |
| `src/index.ts` | barrel |
| `tests/integrations.test.ts` | registration, honest errors, allowlist rejection |

## `packages/ui`

| File | Purpose |
| --- | --- |
| `src/index.tsx` | Card, Badge, EmptyState, StatTile (server-component-safe) |

## `apps/command-center` — the Command Centre

Config: `next.config.ts` (security headers/CSP, transpilePackages),
`middleware.ts` (session refresh + auth gate), `tailwind.config.ts`,
`postcss.config.mjs`, `tsconfig.json`, `package.json`.

Lib: `lib/supabase/server.ts` (RLS user client), `lib/auth.ts`
(`getAuthContext()`), `lib/jarvis.ts` (server-only store/router/limiter
singletons), `lib/setup.ts` (`primeExists()` banner check), `lib/cron-auth.ts`
(constant-time bearer check).

Server actions: `app/actions/auth.ts` (sign in/up/out, claimPrime),
`app/actions/work.ts` (objectives/projects/tasks/decisions via RLS),
`app/actions/approvals.ts` (PRIME-only resolution, dual-enforced),
`app/actions/brief.ts` (permission-checked manual brief).

Pages: `app/layout.tsx`, `app/page.tsx` (redirect), `app/globals.css`,
`app/login/page.tsx`, `app/executive/page.tsx`, `app/businesses/page.tsx`,
`app/businesses/[businessId]/page.tsx`, `app/objectives/page.tsx`,
`app/projects/page.tsx`, `app/tasks/page.tsx`, `app/approvals/page.tsx`,
`app/decisions/page.tsx`, `app/agents/page.tsx`, `app/knowledge/page.tsx`,
`app/reports/page.tsx`, `app/settings/page.tsx`, `app/jarvis/page.tsx`.

API routes: `app/api/jarvis/chat/route.ts` (auth→membership→rate limit→
Zod→orchestrator), `app/api/cron/daily-brief/route.ts` (bearer-gated,
idempotent).

Components: `components/Nav.tsx`, `components/forms.tsx`,
`components/TaskStatusButtons.tsx`, `components/ApprovalActions.tsx`,
`components/GenerateBriefButton.tsx`, `components/ClaimPrimeBanner.tsx`,
`components/ChatUI.tsx`.

Tests: `tests/cron-auth.test.ts`.

## `supabase/` — database

Migrations `0001`–`0008` (see DATABASE.md for the map), `seed/seed.sql`,
`tests/rls_verification.sql`, `tests/local_harness.sql` (local PG16
emulation — never run against real Supabase). `functions/` is an empty
placeholder for future edge functions.

## `docs/` — operator documentation

`setup/local-development.md`, `setup/supabase.md`, `setup/vercel.md`,
`architecture/system-overview.md`, `architecture/ai-routing.md`,
`security/security-model.md`, `security/permissions.md`,
`operations/adding-a-business.md`, `operations/adding-an-agent.md`,
`operations/adding-an-integration.md`, `operations/incident-response.md`.

## `audit-package/` — this package

ARCHITECTURE, DATABASE, SECURITY, AI, APPLICATION, DEPLOYMENT, TESTING,
KNOWN_ISSUES, NEXT_PHASE, CODE_INDEX (this file), MANIFEST (generated file
inventory with SHA-256 checksums).
