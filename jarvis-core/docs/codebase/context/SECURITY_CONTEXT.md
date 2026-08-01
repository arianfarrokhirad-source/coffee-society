<!--
Type: manual
Canonical for: nothing — source + migrations are canonical
Update when: a security control, classification or required test changes
Owner: PRIME
Budget: Tiny (~150 lines)
-->

# Security context

Load for: **any** change touching auth, permissions, audit, secrets, RLS,
approvals, rate limiting or webhooks. If unsure whether your change is
security-relevant, it is — read this.

## Non-negotiables

1. **Secrets are server-only.** Browser gets `NEXT_PUBLIC_SUPABASE_URL` and the
   anon key. Never ship the service-role key, AI keys, `JARVIS_CRON_SECRET` or
   `JARVIS_PRIME_SETUP_TOKEN` toward the client. `createServiceClient()` throws
   in a browser context; `lib/jarvis.ts` imports `server-only`.
2. **Two enforcement layers.** Database RLS **and** application checks. Never
   remove one because the other exists.
3. **Deny by default**, everywhere: unknown actions, unknown tools, malformed
   rate-limit counts, missing config.
4. **Fail closed on security paths.** Missing/short `JARVIS_PRIME_SETUP_TOKEN`
   disables claiming entirely; missing `JARVIS_CRON_SECRET` disables the cron
   endpoint.
5. **One generic error to the user, specific reason internally.** Never leak
   which check failed. Reason codes go to audit + structured logs only.

## Security-critical files (change ⇒ tests below must pass)

| File                                                  | Concern                         | Required tests                                             |
| ----------------------------------------------------- | ------------------------------- | ---------------------------------------------------------- |
| `packages/permissions/src/policy.ts`                  | authority + approval gating     | `packages/permissions/tests/policy.test.ts`                |
| `packages/permissions/src/authority.ts`               | L0–L5 comparison                | `…/tests/authority.test.ts`                                |
| `packages/permissions/src/agent-scope.ts`             | agent containment               | `…/tests/agent-scope.test.ts`                              |
| `packages/workflows/src/tools.ts`                     | enforcement pipeline            | `packages/workflows/tests/tools.test.ts`                   |
| `packages/security/src/{audit,redact}.ts`             | audit + secret redaction        | `packages/security/tests/security.test.ts`                 |
| `packages/security/src/constant-time.ts`              | secret comparison               | `packages/security/tests/constant-time.test.ts`            |
| `packages/database/src/clients.ts`                    | service-role construction       | build must fail if imported client-side                    |
| `apps/command-center/lib/prime-claim.ts`              | PRIME bootstrap logic           | `apps/command-center/tests/prime-claim.test.ts`            |
| `apps/command-center/lib/cron-auth.ts`                | cron bearer check               | `apps/command-center/tests/cron-auth.test.ts`              |
| `apps/command-center/app/actions/{auth,approvals}.ts` | claim + approval transitions    | SQL suites below                                           |
| `apps/command-center/middleware.ts`                   | route gating                    | manual: unauthenticated → 307 `/login`                     |
| `supabase/migrations/0007_rls.sql`                    | RLS policies                    | `supabase/tests/rls_verification.sql`                      |
| `supabase/migrations/0009_prime_bootstrap.sql`        | claim RPC, single-PRIME trigger | `prime_bootstrap_verification.sql` + `race_prime_claim.sh` |

## PRIME bootstrap (implemented, commit 1)

Raw setup token validated **in the server action** (constant-time hash
compare) — it never reaches PostgreSQL, logs or audit. Then: mint single-use,
user-bound, 2-minute nonce (hash stored) → `claim_prime_with_nonce()`
(`service_role` only, empty `search_path`, advisory lock `(742617, 1)`) →
membership + `prime.claimed` audit **in one transaction**. A constraint trigger
independently blocks a second active PRIME. Denials audited as
`prime.claim_denied`, rate limited 5/15 min from audit rows.

## Audit terminology — use exactly these words

- **Append-only** at application/database-role level (trigger blocks
  UPDATE/DELETE for all roles incl. `service_role`).
- **Deletion-resistant** for application roles.
- **NOT tamper-proof** — an owner can drop the trigger.
- **NOT yet tamper-evident** — needs hash chaining.
- **Critical** audits commit with their state change (PRIME claim only today);
  everything else is best-effort telemetry until commit 2.

## Known weaknesses (documented, not defects to fix opportunistically)

CSP allows `'unsafe-inline'` scripts · rate limiter is in-memory per instance
and never evicts keys · public signups open by default · no 2FA · audit
`metadata` lacks IP/user-agent · webhook verifier has no replay protection ·
`JARVIS_ENCRYPTION_KEY` reserved but unused.

## Before you commit a security change

```bash
npx vitest run packages/permissions packages/security apps/command-center
# plus the relevant SQL suite on a fresh PG16
git diff --cached | grep -InE 'sk-|whsec_|BEGIN.*PRIVATE KEY|eyJhbGciOi'   # expect no hits
```

Never weaken a control to make a test pass. Never add an auth bypass for
testing — build the real flow or mark the test not-executed.
