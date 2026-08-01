# ARCHITECTURE — JARVIS Phase 1 Audit

## What this system is

JARVIS is a private, single-founder ("PRIME") multi-business operating system.
Phase 1 is a **secure foundation**: structured company data, work management,
an AI orchestrator with hard permission gates, and full audit logging. It is
explicitly **not** an autonomous system — every external side effect is
blocked behind a human approval that has no executor yet.

## Repository context

The git repository (`coffee-society`) contains an unrelated legacy Next.js
Q&A app at its root (untouched by this project). JARVIS lives entirely in
`jarvis-core/`. This audit package covers `jarvis-core/` plus these audit
documents; the legacy app is out of scope and shares no code, database or
credentials with JARVIS.

## Top-level flow

```
PRIME (browser)
  → Next.js Command Centre (apps/command-center)
      • pages/server actions: RLS-scoped anon-key client (user path)
  → JVS-00 Orchestrator (@jarvis/workflows)
  → Permission & Approval Engine (@jarvis/permissions)
  → AI Provider Router (@jarvis/ai → Anthropic / OpenAI adapters)
  → Supabase PostgreSQL (source of truth)
  → Integration adapters (@jarvis/integrations — all disabled)
```

No service talks to another service directly; all meaningful activity passes
through server-side code and is persisted to `agent_runs`, `tool_calls`,
`model_usage`, `audit_logs` and `system_events`.

## The two data paths (deliberate design)

1. **User path (RLS-enforced).** Dashboards and server actions use the
   anon-key client bound to the user's session cookies
   (`apps/command-center/lib/supabase/server.ts`). The database enforces
   business scope and role access via Row Level Security. A compromised or
   buggy page cannot read past RLS.

2. **Orchestrator path (service role).** The JVS-00 pipeline uses the
   service-role client through the `JarvisStore` seam
   (`packages/database/src/store.ts`), because it must write runs, audits,
   approvals and briefs that ordinary users cannot. Every entry point into
   this path performs application-level permission checks first
   (`@jarvis/permissions`), and everything is audited. The service client
   refuses to construct in a browser context and the app wiring imports
   `server-only`.

Auditors should treat any *new* use of `createServiceClient()` /
`getStore()` that is not preceded by an authorization check as a finding.

## Monorepo layout

| Path | Role |
| --- | --- |
| `apps/command-center` | Next.js 15 App Router UI, server actions, API routes, middleware |
| `packages/shared` | Business/agent registries, authority levels, Zod output schemas, `Result` type |
| `packages/permissions` | Authority comparison, deny-by-default action policy, approval logic, agent scope |
| `packages/security` | Secret redaction, audit event builder, rate limiter, safe errors, HMAC webhook verify |
| `packages/database` | Typed rows, client factories, `JarvisStore` interface + Supabase & in-memory impls |
| `packages/ai` | Provider interfaces, Anthropic/OpenAI fetch adapters, router, structured output |
| `packages/workflows` | Classifier, internal tool pipeline, JVS-00 orchestrator |
| `packages/reporting` | Daily PRIME brief composer/generator, notification delivery adapters |
| `packages/integrations` | External adapter contract + 7 disabled placeholders |
| `packages/ui` | Server-component-safe UI primitives |
| `agents/` | Master constitution + per-agent versioned role cards + `composePrompt()` |
| `supabase/` | 8 migrations, seed, RLS verification suite, local PG16 harness |
| `docs/` | Setup, architecture, security, operations documentation |

Packages are consumed as TypeScript source (`main: ./src/index.ts`) via
Next's `transpilePackages`; there is no per-package build step. Vitest and
`tsc --noEmit` cover them directly.

## JVS-00 orchestration (packages/workflows/src/orchestrator.ts)

Every chat request executes this fixed pipeline:

1. Authenticate requester (session verified server-side in the API route; the
   orchestrator receives an already-verified `JarvisUser`)
2. Determine relevant business (explicit selection wins over classification)
3. Classify (deterministic rules first — see `classifier.ts`; model-assisted
   for free-form when a router exists; safe read-only fallback otherwise)
4. Determine required authority — **application code, never the model**
5. Retrieve only authorized data (through the tool pipeline)
6. Select specialist agent (DB row = capabilities; role card = prompt)
7. Select model route (env-configured, cross-provider fallback)
8. Provide only permitted tools
9. Validate model output with Zod (`executiveResponseSchema`)
10. Create approval records for restricted actions
11. Log the run (`agent_runs` up-front so failures are recorded too)
12. Return a structured `JarvisReply`

Key invariant: when work is delegated to an agent, the acting authority is
the **agent's own level** (L1 default); when JARVIS executes a direct user
command (`show_approvals`, `generate_brief`), it acts under the **user's**
authority. An agent can never borrow PRIME's L5; a low-authority user cannot
escalate through an agent.

## Composable prompt system (agents/)

`Master Constitution (once) + Agent Role Card + Business Context +
Authorized Retrieved Data + Current Task Packet`, assembled by
`composePrompt()` in `agents/src/index.ts`. Role cards are versioned files
(`agents/<business>/role-card.ts`). The constitution is not duplicated
anywhere else in the codebase.

## Events

`system_events` is an idempotent event ledger (unique partial index on
`(organization_id, event_type, dedupe_key)`), written on task creation,
approval transitions, decisions, run completion/failure and brief requests.
Phase 1 has no async consumer — the table is the seam where a worker attaches
later without introducing a broker.

## Notable design decisions and their rationale

- **No AI SDK dependency**: providers are direct-fetch adapters. Fewer
  dependencies to audit, trivially mockable, keys read lazily.
- **`JarvisStore` seam**: security-critical orchestration logic is tested
  against an in-memory implementation; the Supabase implementation is thin
  mapping code.
- **Deterministic-first classification**: the documented command set works
  with zero API keys and is fully unit-tested; the model refines only
  free-form input, and its output is advisory (authority is re-checked in
  the tool pipeline regardless).
- **Deny-by-default everywhere**: unknown action types map to L5 +
  always-approval; unknown tools are denied and audited; agent denylists
  beat allowlists.
