# DEPLOYMENT — JARVIS Phase 1 Audit

## Status

**Not deployed.** The build is Vercel-ready and verified (`next build`
succeeds; production server boots and enforces auth gates/headers), but no
Supabase project, Vercel project or provider keys existed in the build
environment. Everything below is the documented, untested-in-production
procedure — treat it as instructions, not as claims of a live system.

## Prerequisites

| Service | Needed for | Phase 1 requirement |
| --- | --- | --- |
| Supabase | Database, Auth, (Storage later) | required |
| Vercel | Hosting | required for deployment (local-only works without) |
| Anthropic / OpenAI | Model-backed routes | optional — command set works without |

## Order of operations

1. **Supabase**: create project → run `supabase/migrations/0001…0008` in
   order → run `supabase/seed/seed.sql` → run
   `supabase/tests/rls_verification.sql` (must end with
   `RLS VERIFICATION COMPLETE`) → collect URL/anon/service-role keys.
2. **Vercel**: import repo; **Root Directory = `jarvis-core/apps/command-center`**;
   set env vars (below); deploy. If `@jarvis/*` fails to resolve, set the
   install command to `npm install --prefix ../..` (workspace root install).
3. **First login**: sign up → **Claim PRIME** on `/executive` (one-time,
   audited). Then consider disabling public signups in Supabase Auth.
4. **Cron** (optional): schedule `POST /api/cron/daily-brief` with header
   `Authorization: Bearer <JARVIS_CRON_SECRET>`. The endpoint is idempotent
   per organization/day. Note: Vercel Cron does not send custom headers on
   GET-only crons — use a scheduler that can POST with the header (GitHub
   Actions, cron-job.org) or deliberately add a thin authenticated wrapper.
   Do not weaken the secret check to satisfy a scheduler.

## Environment variables

| Variable | Exposure | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | anon key useless without RLS-passing session |
| `SUPABASE_SERVICE_ROLE_KEY` | secret | bypasses RLS; server-only guarded in code |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | secret | optional |
| `JARVIS_MODEL_EXECUTIVE/_DOCUMENT/_EXTRACTION/_REVIEW` | server | no defaults exist in code — unset ⇒ route unavailable |
| `JARVIS_APP_URL` | public | informational |
| `JARVIS_CRON_SECRET` | secret | ≥16 chars or the endpoint refuses all requests |
| `JARVIS_ENCRYPTION_KEY` | secret | reserved; unused in Phase 1 |

`.env.example` at `jarvis-core/.env.example` is the canonical placeholder
list. Local dev copies it to `apps/command-center/.env.local`.

## Runtime characteristics an operator should know

- All routes are server-rendered on demand (no static caching of data).
- The in-memory rate limiter and router/store singletons are **per
  serverless instance** — limits are per-instance, not global (see
  KNOWN_ISSUES).
- Middleware runs on every non-static request and calls Supabase
  `auth.getUser()` (network hop per request).
- Security headers + CSP are set globally in `next.config.ts`; `robots`
  is noindex.
- The cron endpoint and login are the only unauthenticated surfaces, and
  the cron endpoint fails closed without its secret.

## Rollback / migration posture

Migrations are idempotent and additive-only in Phase 1 (no destructive
statements). Rollback strategy is restore-from-backup (Supabase PITR/
backups) rather than down-migrations — acceptable at this stage and worth
revisiting when schema churn begins.

## Verification commands (local)

```bash
cd jarvis-core
npm install
npm run validate           # typecheck + lint + 95 tests + production build
# database chain on plain PG16:
psql -f supabase/tests/local_harness.sql -f supabase/migrations/*.sql \
     -f supabase/seed/seed.sql -f supabase/tests/rls_verification.sql
```
