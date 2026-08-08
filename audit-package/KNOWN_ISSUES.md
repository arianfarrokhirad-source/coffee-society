# KNOWN_ISSUES — JARVIS Phase 1 Audit

Honest list of limitations, accepted trade-offs and residual risks. None of
these are hidden in the code; most are also flagged in inline comments or
the README.

## Security-relevant

1. **CSP allows `'unsafe-inline'` scripts/styles.** Next.js bootstrapping
   requires it without nonce plumbing. Accepted for a private, authenticated,
   noindex tool; tighten with nonces if the surface ever becomes public.
2. **In-memory rate limiting is per-instance.** On serverless (Vercel), each
   instance has its own window, so effective limits scale with instance
   count, and restarts reset state. The `RateLimiter` interface exists so a
   Redis/Upstash implementation can drop in.
3. **Service-role concentration.** All service-role access flows through
   `JarvisStore`; the store itself performs no authorization (by design —
   checks live in one place, before the store). Any *new* call site of
   `getStore()`/`createServiceClient()` must be reviewed for a preceding
   permission check. This is a review-discipline risk, not a current defect.
4. **No 2FA / SSO.** Supabase email+password only (min 10 chars). 2FA is a
   Supabase configuration away and recommended before real operations.
5. **Public signups are open by default.** Anyone who can reach the
   deployment can create an account (with no membership → sees nothing,
   can do nothing). Documented recommendation: disable signups after
   onboarding. A memberless account still consumes auth resources.
6. **Audit metadata lacks IP/user-agent capture** in most call sites (the
   column exists; the chat API and actions do not currently populate
   request metadata). Low effort to add.
7. **`agent_messages` table is unused** — the orchestrator stores run
   summaries but not full message transcripts. Schema is ready; writing
   transcripts (redacted) is a next-phase decision (privacy vs. forensics).
8. **`JARVIS_ENCRYPTION_KEY` is reserved but unused.** Integration
   credentials in Phase 1 live only in env vars; at-rest encryption of
   per-integration config arrives with the first real integration.

## Functional gaps (by design in Phase 1)

9. **No executor for approved actions.** Approving an `external.execute`
   approval records the decision; nothing runs. This is the intended
   Phase 1 posture (no external side effects at all).
10. **Document upload UI absent.** Metadata/classification/versioning/search
    schema and pages exist; Supabase Storage wiring is documented only.
11. **Notifications are in-app only.** Delivery adapter interface exists;
    no email/push/Telegram adapters yet.
12. **No streaming chat responses.** Structured JSON replies; the run
    completes then renders. Acceptable at current latency budgets.
13. **`review` route unused by chat.** Second-model review is plumbed in the
    router but no workflow invokes it yet.
14. **`task_dependencies` has schema + RLS but no UI.**
15. **FORGE pilot tables have schema + RLS but no UI** (leads/audits/
    proposals pages are next-phase).
16. **system_events has no consumer.** Events accumulate with status
    `pending`; the processing abstraction is the documented seam for a
    worker. Table growth is bounded by usage volume, not runaway loops.

## Operational / quality

17. **Hand-maintained DB row types** (`packages/database/src/types.ts`) can
    drift from SQL; mitigated by the narrow store seam and tests, fixable
    with Supabase codegen later.
18. **Vercel Cron cannot send the required POST + bearer header natively**;
    an external scheduler (or a deliberate wrapper) is needed for scheduled
    briefs. Manual generation works regardless.
19. **Middleware calls Supabase per request** (session refresh + gate) —
    a network hop on every navigation; standard for @supabase/ssr but worth
    watching at scale.
20. **The classifier's business detection is keyword-based**; a message
    naming two businesses picks the first match (code beats name). Explicit
    business selection in the chat UI overrides it.
21. **No down-migrations**; rollback = restore from backup (documented).
22. **Legacy coffee-society app** shares the repository root. It is inert
    and credential-disjoint, but repo-level tooling (e.g. dependabot) would
    see both projects.

## Deployment truth

23. **Never deployed; never run against a live Supabase project.** The DB
    chain was verified on plain PostgreSQL 16 with a Supabase-runtime shim;
    provider adapters were never exercised against real APIs (no keys). The
    completion report and TESTING.md state exactly what was and wasn't
    verified — nothing beyond that should be assumed.
