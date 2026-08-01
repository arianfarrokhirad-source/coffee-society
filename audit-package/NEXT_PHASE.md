# NEXT_PHASE — Recommended Phase 2 Scope

Ordered by value-to-risk ratio. Each item names the seam it plugs into —
nothing below requires re-architecture.

## 1. Approval executors (highest leverage, highest care)

Give approved approvals a controlled execution path:
- An `ApprovalExecutor` registry keyed by `action_type`, invoked only from a
  server context after PRIME approval, writing `executed_at` /
  `execution_result` and auditing.
- Start with **internal** low-risk executors (e.g. apply the deferred
  `task.update` captured in `action_payload`), then graduate to external
  ones per-integration.
- Guardrails to keep: executor allowlist (no dynamic dispatch on payload),
  idempotency via approval id, expiry enforcement (`expires_at` exists),
  L3 minimum for external execution per the authority model.

## 2. FORGE pilot workflow UI

The tables and RLS exist. Build lead list/detail, audit capture, proposal
drafting (agent-drafted via `document` route, human-approved via the
existing approval flow), and the lead→audit→proposal→approval→client→project
pipeline. First real revenue-facing surface with zero new security ground.

## 3. First live integration: Firecrawl for website audits

- Implement the adapter against the existing `IntegrationAdapter` contract
  (config schema, allowlist, honest `configured_untested` status until a
  connection test passes).
- Gate enablement behind the `integration.connect` always-approval action.
- Feed results into `website_audits.findings`.

## 4. Document storage wiring

Supabase Storage bucket (private) + upload server action + version bump on
re-upload + `searchable_text` extraction. Interfaces for future embeddings
already exist (`documents` schema); defer vector search until needed.

## 5. system_events consumer

A cron-driven worker endpoint (same bearer pattern as the brief) that claims
`pending` events (status → `processing` with attempts++), executes handlers
(e.g. overdue-task detection emitting `task.overdue` + P1 notifications),
and marks `completed`/`failed`. The dedupe index already guarantees
idempotent emission.

## 6. Notification delivery adapters

Email first (single founder): implement a `NotificationDeliveryAdapter`
(interface shipped) with per-priority routing (P0/P1 → external channel,
P2/P3 in-app). External sends go through the approval-audited side-effect
rules.

## 7. Hardening batch (small, do alongside any of the above)

- Distributed rate limiter (Upstash) behind the existing interface
- Populate audit `metadata` with IP/user-agent in API routes and actions
- Supabase 2FA + disable public signups post-onboarding
- CSP nonces if the tool ever leaves private use
- Supabase type codegen to replace hand-maintained row types
- Playwright smoke: login → claim guard → create task → approval flow
- Server-action unit tests (extract logic behind testable functions)

## 8. ORACLE research surface (respecting financial safety)

Read-only dashboards over manually imported financials; forecasting drafts
via the `review` route (second-model check already plumbed); research memos
as documents. **No execution rails** — keep `finance.execute` unexecutable
until a dedicated risk review.

## Explicitly deferred further

Client portal (client role stays locked out), public publishing, autonomous
communications, trading/banking of any kind, multi-org support, vector
search, streaming chat.
