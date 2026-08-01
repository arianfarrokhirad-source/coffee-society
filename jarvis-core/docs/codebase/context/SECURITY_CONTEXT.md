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

| File                                                  | Concern                         | Required tests                                                    |
| ----------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------- |
| `packages/permissions/src/policy.ts`                  | authority + approval gating     | `packages/permissions/tests/policy.test.ts`                       |
| `packages/permissions/src/authority.ts`               | L0–L5 comparison                | `…/tests/authority.test.ts`                                       |
| `packages/permissions/src/agent-scope.ts`             | agent containment               | `…/tests/agent-scope.test.ts`                                     |
| `packages/workflows/src/tools.ts`                     | enforcement pipeline            | `packages/workflows/tests/tools.test.ts`                          |
| `packages/security/src/{audit,redact}.ts`             | audit + secret redaction        | `packages/security/tests/security.test.ts`                        |
| `packages/security/src/constant-time.ts`              | secret comparison               | `packages/security/tests/constant-time.test.ts`                   |
| `packages/database/src/clients.ts`                    | service-role construction       | build must fail if imported client-side                           |
| `apps/command-center/lib/prime-claim.ts`              | PRIME bootstrap logic           | `apps/command-center/tests/prime-claim.test.ts`                   |
| `apps/command-center/lib/cron-auth.ts`                | cron bearer check               | `apps/command-center/tests/cron-auth.test.ts`                     |
| `apps/command-center/app/actions/{auth,approvals}.ts` | claim + approval transitions    | SQL suites below                                                  |
| `apps/command-center/lib/approval-transitions.ts`     | RPC error mapping (no leaks)    | `apps/command-center/tests/approval-transitions.test.ts`          |
| `packages/shared/src/approval-transitions.ts`         | transition matrix mirror        | `…/approval-transitions.test.ts` + `transition_parity.sh`         |
| `apps/command-center/middleware.ts`                   | route gating                    | manual: unauthenticated → 307 `/login`                            |
| `supabase/migrations/0007_rls.sql`                    | RLS policies                    | `supabase/tests/rls_verification.sql`                             |
| `supabase/migrations/0009_prime_bootstrap.sql`        | claim RPC, single-PRIME trigger | `prime_bootstrap_verification.sql` + `race_prime_claim.sh`        |
| `supabase/migrations/0010_critical_auditing.sql`      | atomic critical audit RPCs      | `critical_audit_verification.sql` + `race_approval_transition.sh` |

## PRIME bootstrap (implemented, commit 1)

Raw setup token validated **in the server action** (constant-time hash
compare) — it never reaches PostgreSQL, logs or audit. Then: mint single-use,
user-bound, 2-minute nonce (hash stored) → `claim_prime_with_nonce()`
(`service_role` only, empty `search_path`, advisory lock `(742617, 1)`) →
membership + `prime.claimed` audit **in one transaction**. A constraint trigger
independently blocks a second active PRIME. Denials audited as
`prime.claim_denied`, rate limited 5/15 min from audit rows.

## Fail-closed critical auditing (implemented, commit 2)

Every security-critical state change moves behind a `SECURITY DEFINER` RPC in
`0010_critical_auditing.sql` that applies the change, writes the audit row and
emits the domain event **in one transaction**. Any failure rolls back all
three, so a decision can never exist without the record of who made it.

The boundary is structural, not advisory: 0010 also **drops**
`approvals_update_prime`, `approvals_insert`, `memberships_write_prime` and
`agents_write`, leaving the RPCs as the only write path. `rls_verification.sql`
pins those drops so a later migration cannot quietly restore them.

- **Transition rules live in ONE place**: `public.approval_transition_allowed`.
  The TypeScript mirror in `@jarvis/shared` is pinned to it by
  `transition_parity.sh`, which compares all 320 combinations.
- **Guards**: `not_prime` · `stale_status` (optimistic concurrency) ·
  `invalid_transition` · `self_modification_denied` ·
  `authority_ceiling_exceeded` · `last_prime_protected` · `invalid_amount`.
- **Idempotency**: `(resource_id, action, request_id)` unique index, plus
  `(action, request_id)` for creations — a created row's id is generated by the
  operation, so it cannot collide on resource id. Creation additionally takes
  advisory lock `(742618, hashtext(request_id))` so a concurrent duplicate
  waits and returns the first result rather than erroring.
- **`request_origin`** (`web` · `agent` · `cron` · `api` · `executor` ·
  `migration`) is validated inside `write_critical_audit` and always wins over
  caller-supplied metadata.
- **Payloads are hashed, never copied**: approval audits carry
  `payload_sha256`, so a secret in an action argument cannot be read back out
  of the audit log.

`last_prime_protected` is **defence in depth and currently unreachable**:
reaching it needs a second active PRIME as actor, which 0009's single-PRIME
trigger forbids, and a PRIME cannot act on its own row. It is retained for when
delegated administration makes it reachable. Check 15 of
`critical_audit_verification.sql` pins that composition.

## Audit terminology — use exactly these words

- **Append-only** at application/database-role level (trigger blocks
  UPDATE/DELETE for all roles incl. `service_role`).
- **Deletion-resistant** for application roles.
- **NOT tamper-proof** — an owner can drop the trigger.
- **NOT yet tamper-evident** — needs hash chaining.
- **Critical** audits commit with their state change (the 16 actions in
  `CRITICAL_AUDIT_ACTIONS`); `buildAuditEvent` throws if handed one, so the
  non-atomic path cannot be used by accident.
- **Telemetry** audits (tool calls, run lifecycle, briefs, auth) are
  best-effort and non-transactional by design.
- **NOT globally atomic** with third-party systems — Supabase Auth and any
  future external executor are separate transactional domains.

## Known weaknesses (documented, not defects to fix opportunistically)

CSP allows `'unsafe-inline'` scripts · rate limiter is in-memory per instance
and never evicts keys · public signups open by default · no 2FA · audit
`metadata` lacks IP/user-agent · webhook verifier has no replay protection ·
`JARVIS_ENCRYPTION_KEY` reserved but unused · an approved action has no
`unknown_outcome` state, so a future executor that dies mid-flight would leave
a row reading `approved` (see `ARCHITECTURE_EVOLUTION.md`).

## Before you commit a security change

```bash
npx vitest run packages/permissions packages/security apps/command-center
# plus the relevant SQL suite on a fresh PG16
git diff --cached | grep -InE 'sk-|whsec_|BEGIN.*PRIVATE KEY|eyJhbGciOi'   # expect no hits
```

Never weaken a control to make a test pass. Never add an auth bypass for
testing — build the real flow or mark the test not-executed.
