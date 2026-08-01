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
5. **Everything meaningful is logged** to append-only `audit_logs`
   (UPDATE/DELETE blocked by trigger even for the service role), plus
   `agent_runs`, `tool_calls`, `model_usage`, `system_events`. Secrets are
   redacted (`@jarvis/security/redact`) before persistence.

## Authentication & session

Supabase Auth (email/password), cookie sessions via `@supabase/ssr`.
Middleware refreshes sessions and gates every route except `/login` and the
cron endpoint (which has its own constant-time bearer check, refusing to run
with a missing/short secret). Auth events are audited.

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
