# APPLICATION — JARVIS Phase 1 Audit

Next.js 15 (App Router) + React 19 in `jarvis-core/apps/command-center`.
All pages are dynamic (`force-dynamic`) server components except the small
client components listed below. Tailwind 3 with a dark executive theme;
shared primitives from `@jarvis/ui`.

## Route inventory

| Route | Purpose | Data path |
| --- | --- | --- |
| `/login` | Sign in / sign up (client page, server actions) | Supabase Auth |
| `/` | Redirect → `/executive` | — |
| `/executive` | Org dashboard: stat tiles, risks, approvals, decisions, runs, brief, system errors; claim-PRIME banner; honest empty states (revenue explicitly "not connected — nothing fabricated") | RLS |
| `/businesses` | A00–A08 cards | RLS |
| `/businesses/[businessId]` | Per-business dashboard (tasks/projects/objectives/approvals/agents) | RLS |
| `/objectives`, `/projects`, `/tasks` | Lists + create forms; task status transitions | RLS + server actions |
| `/approvals` | Approval Centre: pending queue with risk/cost badges; approve/reject/cancel (PRIME-only UI, dual-enforced); resolution history | RLS + service audit |
| `/decisions` | Decision log + record form | RLS |
| `/agents` | Agent registry: authority, allowed/prohibited actions, financial authority | RLS |
| `/knowledge` | Document metadata list + title search; empty-state guidance | RLS |
| `/reports` | Latest brief rendered in 6 sections + generate button + history | RLS (+ service store for generation) |
| `/settings` | Account, provider config booleans, integration statuses | RLS + env booleans |
| `/jarvis` | Chat UI (business selector incl. auto-route, suggestions, per-reply metadata: business/agent/intent/provider/model/run id/approval link) | API route |
| `POST /api/jarvis/chat` | Auth → membership → rate limit → Zod body → `runJarvis` | service via orchestrator |
| `POST /api/cron/daily-brief` | Constant-time bearer auth → idempotent brief | service |

## Middleware (`middleware.ts`)

Session refresh via `@supabase/ssr`; everything except `/login` and the cron
route requires a user (307 → `/login?next=…`); authenticated users are
bounced off `/login`. Static assets excluded by matcher.

## Auth context (`lib/auth.ts`)

`getAuthContext()` (React `cache`d per request) reads the user via the
RLS-scoped client — a user can only see their own memberships. Produces
`{userId, memberships, organizationId, authority = max(membership levels),
isPrime, hasMembership}`. All server actions and the chat API consume this;
nothing trusts client-supplied identity.

## Server actions

- `app/actions/auth.ts` — signIn/signUp/signOut (Zod-validated, min 10-char
  password, audited), `claimPrime()` → DB `claim_prime()` RPC.
- `app/actions/work.ts` — createObjective/createProject/createTask/
  updateTaskStatus/recordDecision. All: membership check → Zod parse →
  **RLS-scoped insert/update** (DB enforces business access) → audit → 
  system event where applicable → `revalidatePath`.
- `app/actions/approvals.ts` — `resolveApproval` (approved/rejected/
  cancelled): app-level `isPrime` check + RLS PRIME-only update policy;
  guards `pending → X` transition with a conditional update; audits with
  before/after; emits `approval.*` system event. Approving records the
  decision only — **no executor exists** for external actions (by design).
- `app/actions/brief.ts` — permission-checked (`brief.generate`, L2) manual
  brief generation through the service store, audited.

## Server-only wiring (`lib/jarvis.ts`)

Singletons for the orchestrator path: Supabase service store, AI router
(only providers with keys), 30/min rate limiter. Imports `server-only` —
bundling into a client component is a build error. `providerStatus()`
exposes only booleans.

## Client components (the complete list)

`app/login/page.tsx`, `components/ChatUI.tsx`, `components/forms.tsx`,
`components/TaskStatusButtons.tsx`, `components/ApprovalActions.tsx`,
`components/GenerateBriefButton.tsx`, `components/ClaimPrimeBanner.tsx`.
None import anything from the service path; they call server actions or the
chat API only.

## Empty states & honesty rules

Every list renders an instructive empty state instead of placeholder data.
The Executive "Revenue" card states no financial metrics are connected.
Chat replies label deterministic answers ("no model (deterministic)") and
name the provider/model when one was used.

## Legacy app

The repository root contains the pre-existing "Coffee Society" app (own
package.json, `app/`, `migrations/migration1.sql`). It is untouched, shares
nothing with JARVIS, and is excluded from this audit package except by this
mention. Its known weaknesses (shared admin password cookie, service-role
reads) are legacy-scoped and do not affect JARVIS.
