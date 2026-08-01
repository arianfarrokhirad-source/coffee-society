# Security model

## Principles

1. **Secrets are server-only.** The browser receives only
   `NEXT_PUBLIC_SUPABASE_URL` and the anon key (useless without RLS-passing
   credentials). Service-role key, AI keys, cron secret: server env only.
   `@jarvis/database`'s `createServiceClient()` throws if a browser context is
   detected, and `lib/jarvis.ts` imports `server-only`.
2. **Two enforcement layers.** Database RLS _and_ application checks. PRIME-only
   approval resolution, for example, is checked in the server action and again
   by the RLS update policy — a bug in one layer cannot bypass the other.
3. **Deny by default.** Unknown action types map to an L5 / always-approval
   policy. Unknown tools are denied and audited. Agents have explicit
   allowlists _and_ denylists; the denylist wins.
4. **Models have no permissions.** Application code decides everything. Model
   output is Zod-validated; classifications cannot lower the approval bar for
   external actions; an agent's acting authority is its own (L1 default), never
   the user's.
5. **Everything meaningful is logged** to `audit_logs`, plus `agent_runs`,
   `tool_calls`, `model_usage`, `system_events`. Secrets are redacted
   (`@jarvis/security/redact`) before persistence.

## Audit log guarantees — precise terminology

State these accurately; do not overstate them:

- **Append-only at the application/database-role level** — BEFORE UPDATE and
  BEFORE DELETE triggers reject mutation for every role, including
  `service_role` (RLS bypass does not bypass triggers).
- **Deletion-resistant for application roles** — removing rows requires
  dropping the trigger inside a migration, which is itself an auditable act
  performed by a database owner.
- **NOT tamper-proof.** A superuser or table owner can disable the trigger.
- **NOT yet tamper-evident** — that requires hash chaining (each row
  committing to its predecessor), which is planned but not implemented.

- **NOT globally atomic with third-party systems.** Supabase Auth and any
  future external executor are separate transactional domains.

Writes fall into two classes, and the distinction is a security boundary
rather than a naming convention:

**Critical (fail-closed).** The state change, its audit row and its domain
event commit in one database transaction, so the change cannot exist without
the record of who made it. `0010_critical_auditing.sql` covers approval
creation, every approval transition, membership assignment/role change/
revocation, and every agent authority change; `0009` covers PRIME claiming.
Each runs as a `SECURITY DEFINER` function with an empty `search_path`,
granted only to `service_role`.

The boundary is structural: 0010 **drops** the client write policies
`approvals_update_prime`, `approvals_insert`, `memberships_write_prime` and
`agents_write`, so the RPCs are the only remaining write path. Application
code cannot opt out — `buildAuditEvent` throws if handed one of the 16
critical actions.

Approval audits record `payload_sha256` and never the payload itself, so a
secret inside an action argument cannot be read back out of the audit log.
Each critical audit row carries a `request_id` and a validated
`request_origin` (`web`, `agent`, `cron`, `api`, `executor`, `migration`).

**Telemetry (best-effort).** Tool calls, run summaries, brief generation and
auth events. Losing one is an observability gap, not a governance failure.

## Authentication & session

Supabase Auth (email/password), cookie sessions via `@supabase/ssr`.
Middleware refreshes sessions and gates every route except `/login` and the
cron endpoint (which has its own constant-time bearer check, refusing to run
with a missing/short secret). Auth events are audited.

### PRIME bootstrap (setup token)

Becoming PRIME requires the server-only `JARVIS_PRIME_SETUP_TOKEN` (min 32
chars; unset ⇒ claiming disabled). Trust boundary: the raw token is compared
in the server action via constant-time hash comparison and **never reaches
PostgreSQL, logs, or the audit trail**. A validated attempt mints a
single-use, user-bound, 2-minute nonce (SHA-256 hash stored; RLS-enabled table
with zero policies) and calls the `service_role`-only RPC
`claim_prime_with_nonce()`, which derives the claimant from the nonce row,
holds advisory lock `(742617, 1)`, and commits membership + audit atomically.
A `memberships` constraint trigger independently prevents a second active
PRIME. Denials are audited (`prime.claim_denied`) and rate limited (5 / 15 min
per account, counted from audit rows — a bootstrap-only limiter, not the final
distributed design); the browser receives one generic message in all cases.
See `docs/setup/supabase.md` for the safe deployment order.

## Web hardening

- Global headers (next.config.ts): CSP (self-only + Supabase connect),
  `X-Frame-Options: DENY`, `nosniff`, strict referrer, restricted
  Permissions-Policy; `noindex`.
- Server actions validate all inputs with Zod; forms are same-origin
  (`form-action 'self'`), and Next server actions carry origin checks
  (CSRF-conscious posture).
- Errors shown to users are generic (`toSafeError`); details go to server
  logs/audit. No stack traces in production responses.
- Rate limiting: in-memory sliding window on chat + tool pipeline
  (interface allows Redis later).
- Webhooks (future integrations): HMAC-SHA256 verification interface with
  timing-safe comparison. No custom cryptography anywhere.

## Financial safety

No trading, exchange access, leverage or money movement exists in the code.
Every agent has `max_financial_authority = 0`; any non-zero estimated cost
forces an approval. ORACLE's role card labels alternative signals
(numerology, astrology, mineral symbolism, zodiac) as experimental research
inputs, never predictive variables — and its prohibited actions include
`trading` and `money_transfer`.

## Secret hygiene

- `.env.example` contains placeholders only; `.gitignore` excludes `.env*`.
- Recommended: enable GitHub secret scanning + push protection on the repo;
  run `npm audit` (and `npm audit fix` after review) on a schedule; rotate the
  service-role key if it ever leaves server config.

## Verification

- `supabase/tests/rls_verification.sql`: RLS enabled everywhere, no allow-all
  policies, no client write policies on server-only tables, append-only audit,
  seed sanity, anon/memberless isolation.
- 95 unit tests cover authority comparison, approval requirement, agent scope,
  restricted-action denial, audit creation, redaction, routing, structured
  validation, brief composition and cron auth.
