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

## 7. Assign PRIME (secure, no hard-coded emails)

Sign up in the app, then click **Claim PRIME** on the Executive page. This
calls the `claim_prime()` database function, which:

- requires an authenticated session,
- takes an advisory lock (no race between two claimants),
- assigns org-wide `prime` membership at authority L5 **only if no PRIME exists**,
- writes a `prime.claimed` audit record,
- refuses forever after.

## 8. Storage (documents, optional in Phase 1)

Create a private bucket named `documents` (Storage → New bucket, public OFF).
Document metadata/versioning tables are ready; the upload UI arrives in a
later phase.
