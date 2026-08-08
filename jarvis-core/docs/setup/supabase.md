# Supabase setup

## 1. Create the project

1. https://supabase.com/dashboard → **New project**
2. Choose a strong database password and a region close to you
3. Wait for provisioning

## 2. Apply migrations

Open **SQL Editor** and run each file from `supabase/migrations/` **in order**:

1. `0001_extensions_enums.sql`
2. `0002_core_identity.sql`
3. `0003_agents.sql`
4. `0004_work.sql`
5. `0005_documents.sql`
6. `0006_runs_audit.sql`
7. `0007_rls.sql`
8. `0008_forge_pilot.sql`

All migrations are idempotent — re-running them is safe.

## 3. Seed

Run `supabase/seed/seed.sql`. This creates the organization (ATLAS Holdings),
roles, permissions, businesses **A00–A08** (A08 VOID dormant with agents
disabled) and the 10 agent definitions. It contains no personal data.

## 4. Verify security

Run `supabase/tests/rls_verification.sql`. Every check raises an exception on
failure; the final row should read `RLS VERIFICATION COMPLETE`.

## 5. Collect credentials

**Settings → API**:

- Project URL → `NEXT_PUBLIC_SUPABASE_URL`
- `anon` public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY` (browser-safe; RLS applies)
- `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (**server-only — bypasses RLS**)

## 6. Auth configuration

- **Authentication → Providers → Email**: enabled by default. For a
  single-founder deployment, consider disabling public signups after PRIME
  and any staff accounts exist (Authentication → Settings).
- If "Confirm email" is ON, confirm the first account before signing in;
  the login page notes this.

## 7. Assign PRIME (setup-token bootstrap)

**Safe deployment order — follow it exactly:**

1. **Deploy privately** (no public link shared; ideally before DNS is announced).
2. **Configure the setup token** as a server-only env var:
   ```bash
   openssl rand -base64 32   # generate real entropy — do not hand-write a phrase
   ```
   Set the result as `JARVIS_PRIME_SETUP_TOKEN` (min 32 chars). Until this is
   set, claiming PRIME is **disabled entirely** — nobody can become PRIME.
3. **Create the founder account** at `/login`.
4. **Claim PRIME**: on `/executive`, enter the setup token and submit.
5. **Remove or rotate the token** in your hosting env and redeploy. (Claiming
   is already impossible once PRIME exists; removing it eliminates the secret.)
6. **Restrict signups** (Supabase → Authentication → Settings) so no further
   accounts can be created without your involvement.

### How it works

The raw token is validated **in the server action**, never in PostgreSQL:
constant-time comparison against the env var. On success the server mints a
single-use, user-bound nonce valid for two minutes (only its SHA-256 hash is
stored) and calls `claim_prime_with_nonce()`, a `service_role`-only RPC that in
one transaction:

- takes the reserved advisory lock `(742617, 1)` — no race between claimants,
- locks and validates the nonce (unexpired, unconsumed, bound to this user),
- derives the claimant identity **from the nonce row**,
- verifies no active PRIME exists,
- consumes the nonce, inserts the org-wide `prime` membership at L5, and writes
  the `prime.claimed` audit row — all-or-nothing.

A `memberships` constraint trigger independently rejects a second active PRIME
membership, so even a future code path cannot create two.

Failed attempts are audited as `prime.claim_denied` and rate limited (5 per 15
minutes per account, counted from audit rows). The browser always receives one
generic error — it never learns whether the token was wrong, claiming was
disabled, or the attempt was rate limited.

The legacy first-user-wins `claim_prime()` function is **dropped**. There is no
downgrade path that restores it; a rollback needs a secure replacement, not the
old function.

## 8. Storage (documents, optional in Phase 1)

Create a private bucket named `documents` (Storage → New bucket, public OFF).
Document metadata/versioning tables are ready; the upload UI arrives in a
later phase.
