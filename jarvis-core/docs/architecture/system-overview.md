# System overview

## Architecture

```
PRIME (browser)
  → Next.js Command Centre (apps/command-center)
      pages: RLS-scoped reads via the user's anon-key session client
      server actions: validated writes, still RLS-scoped
  → Server-side JARVIS Orchestrator (@jarvis/workflows, JVS-00)
  → Permission & Approval Engine (@jarvis/permissions)
  → AI Provider Router (@jarvis/ai → Anthropic / OpenAI)
  → Supabase (source of truth; service-role only behind the orchestrator)
  → Integration adapters (@jarvis/integrations — all disabled in Phase 1)
```

Nothing connects service-to-service directly; every meaningful operation runs
through server-side code and is logged (`agent_runs`, `tool_calls`,
`model_usage`, `audit_logs`, `system_events`).

## Two data paths, on purpose

1. **User path (RLS)** — dashboards and server actions use the anon-key client
   bound to the session. The database itself enforces business scope and
   role access. A compromised page cannot read past RLS.
2. **Orchestrator path (service role)** — the JVS-00 pipeline uses the
   service-role client via `JarvisStore`, because it must write runs, audits
   and approvals that users cannot. Every entry point into this path performs
   application-level permission checks (`@jarvis/permissions`) before touching
   data, and everything is audited.

## Orchestration pipeline (JVS-00)

1. Authenticate requester (session, server-verified)
2. Determine relevant business (explicit selection or classification)
3. Classify the request (deterministic rules first, model-assisted for free-form)
4. Determine required authority (application decides — never the model)
5. Retrieve only authorized information (scoped internal tools)
6. Select the specialist agent (A00-GM … A08-RSV)
7. Select the model route (env-configured)
8. Provide only permitted tools
9. Validate model output (Zod; free text is never trusted for orchestration)
10. Create an approval when required
11. Log the complete run
12. Return a structured response

## Composable prompts

`Master Constitution + Agent Role Card + Business Context + Authorized
Retrieved Data + Current Task Packet` — assembled by `composePrompt()` in
`agents/src/index.ts`. The constitution exists once; role cards are versioned
files under `agents/<business>/role-card.ts`.

## Events

`system_events` records lifecycle events (`task.created`,
`approval.requested/approved/rejected`, `decision.recorded`,
`agent.run.completed/failed`, `daily_brief.requested`) with a
`dedupe_key` unique index for idempotency. Phase 1 processes nothing
asynchronously — the table is the seam where a worker plugs in later without
a message broker.

## Monorepo

npm workspaces; packages are consumed as TypeScript source via
`transpilePackages` (no per-package build step). Strict TS everywhere;
`@jarvis/security` and `@jarvis/permissions` are dependency-light so the
security-critical logic stays trivially unit-testable.
