# SECURITY — JARVIS Phase 1 Audit

## Threat model (what the controls defend against)

- A compromised browser session or buggy page reading beyond its scope
  → RLS is the backstop on the user path
- A prompt-injected or misbehaving model attempting restricted actions
  → models hold no permissions; tool pipeline re-checks everything;
    external actions always become approvals
- A lower-authority user escalating through an agent
  → acting authority = min(agent's own level); agents never inherit
- Secret exfiltration via logs
  → redaction before persistence; keys never sent to the client bundle
- Tampering with the audit trail
  → append-only at the DB level, even for the service role

## Authority & approval engine (`packages/permissions`)

- Levels `L0..L5`; `meetsAuthority` inclusive; validated string guard.
- `ACTION_POLICIES` (policy.ts): every known action type →
  `{minAuthority, external, alwaysApproval, risk}`.
  `external.execute`, `client.message`, `public.publish`, `finance.execute`,
  `integration.connect`, `permission.change` are **alwaysApproval**
  regardless of actor authority (including PRIME).
- `UNKNOWN_ACTION_POLICY`: L5 + alwaysApproval + critical — deny by default.
- `checkApproval()` also forces approval when `estimatedCost >` the actor's
  financial authority. Agents are seeded with 0; users get effectively
  unlimited *only* for actions they already meet the authority bar for.
- `canAgentAct()` (agent-scope.ts): inactive agent → deny; prohibited list
  → deny (even if the same action is also allowed — denylist wins);
  cross-business → deny (JVS-00 with `businessCode: null` is org-level);
  not in allowlist → deny.

## Tool pipeline (`packages/workflows/src/tools.ts`)

Order of checks (any failure short-circuits, is recorded in `tool_calls`,
and audited):

```
rate limit → tool exists → Zod arg validation → agent scope →
action policy/approval check → execute → log
```

When the policy check fails for any tool except `requestApproval`, the
pipeline **creates a pending approval record** capturing the tool + args and
returns `approval_created` — restricted requests become approvals, never
silent failures or executions. There is deliberately no executor for
approved external actions in Phase 1.

## Secrets

- Browser receives only `NEXT_PUBLIC_SUPABASE_URL` and the anon key.
- `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
  `JARVIS_CRON_SECRET`, `JARVIS_ENCRYPTION_KEY`: server env only.
- `createServiceClient()` throws if `window` exists in `globalThis`;
  `apps/command-center/lib/jarvis.ts` imports `server-only` (build-time
  guarantee it cannot enter a client bundle).
- `.env*` git-ignored at both repo root and `jarvis-core/`; `.env.example`
  contains placeholders only. `git status` was verified clean of env files
  before every push.
- Redaction (`packages/security/src/redact.ts`): key-pattern
  (`key|secret|token|password|credential|authorization|cookie|signature`)
  and value-pattern (`sk-…`, `whsec_…`, JWT-shaped) redaction, depth-capped,
  applied by `buildAuditEvent()` to before/after/metadata payloads.

## Authentication & session

- Supabase Auth email/password via `@supabase/ssr` cookie sessions.
- `middleware.ts` refreshes sessions and gates every route except `/login`
  and the cron endpoint; unauthenticated navigation 307s to `/login`
  (verified against the running production server).
- Password minimum 10 chars enforced in the server action schema.
- Auth events (`auth.sign_in/sign_up/sign_out`) are audit-logged.

## PRIME bootstrap (`claim_prime()` in `0007_rls.sql`)

SECURITY DEFINER function: requires `auth.uid()`; takes
`pg_advisory_xact_lock` (no claim race); inserts org-wide `prime` membership
at L5 **only if none exists**; writes a `prime.claimed` audit row; revoked
from `anon`, granted to `authenticated`. No email is hard-coded anywhere in
the codebase. Behaviorally verified: second claimant is refused.

## Dual enforcement examples (check both layers when auditing changes)

| Control | Application layer | Database layer |
| --- | --- | --- |
| Approval resolution | `resolveApproval` checks `isPrime` | approvals UPDATE policy = PRIME only |
| Business scoping | tool ctx + agent scope | `has_business_access()` in every policy |
| Client isolation | no client UI paths | `client` role excluded from `has_business_access` |
| Audit immutability | no update/delete code paths | append-only triggers |

## Web hardening

- Global headers (`next.config.ts`): CSP (`default-src 'self'`; connect only
  to self + `*.supabase.co`; `frame-ancestors 'none'`; `form-action 'self'`),
  `X-Frame-Options: DENY`, `nosniff`, strict referrer, restrictive
  Permissions-Policy. Verified present on live responses.
  Note: `script-src 'unsafe-inline'` is required by Next bootstrapping
  without nonce plumbing — acceptable for a private authenticated tool,
  listed in KNOWN_ISSUES.
- Safe errors: `toSafeError()` returns a generic message unless the error is
  an explicit `PublicError`; raw errors go to server logs only.
- Rate limiting: in-memory sliding window (30/min per user on chat; injected
  into the tool pipeline). Interface allows a distributed impl later.
- Cron endpoint: constant-time bearer comparison; refuses to operate when
  the secret is missing or `<16` chars (fail-closed). Verified 401 live.
- Webhook interface: HMAC-SHA256 with `timingSafeEqual`; no custom crypto
  anywhere.

## Financial safety

No code path can move money: no trading/exchange/transfer integrations
exist; `finance.execute` is alwaysApproval and has no executor; every agent
has zero financial authority; ORACLE's role card + prohibited actions ban
trading and transfers; alternative signals (numerology/astrology/minerals/
zodiac) are constitutionally labelled experimental research inputs.

## Residual risks (see KNOWN_ISSUES.md for the full list)

- In-memory rate limiter resets per instance/deployment
- CSP allows inline scripts (Next default)
- Service-role usage concentration in `JarvisStore` means new call sites
  must be reviewed for preceding permission checks
- No 2FA on Supabase Auth in Phase 1 (available via Supabase config)
