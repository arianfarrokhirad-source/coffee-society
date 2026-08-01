# Vercel deployment

## Project settings

- **Root Directory**: `jarvis-core/apps/command-center`
- Framework preset: Next.js (auto-detected)
- Node.js 20+

Because the app lives in an npm workspace, Vercel must install from the
monorepo root — it detects this automatically when the root directory is set
as above and the repository contains `jarvis-core/package.json` workspaces.
If the build cannot resolve `@jarvis/*` packages, set
**Install Command** to `npm install --prefix ../..`.

## Environment variables

Add every variable from `.env.example`:

| Variable                                                    | Exposure                           |
| ----------------------------------------------------------- | ---------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public                             |
| `SUPABASE_SERVICE_ROLE_KEY`                                 | **server-only, secret**            |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`                       | **server-only, secret**            |
| `JARVIS_MODEL_EXECUTIVE/DOCUMENT/EXTRACTION/REVIEW`         | server-only                        |
| `JARVIS_APP_URL`                                            | public (your deployment URL)       |
| `JARVIS_CRON_SECRET`                                        | **server-only, secret**, ≥16 chars |
| `JARVIS_ENCRYPTION_KEY`                                     | **server-only, secret** (reserved) |

## Scheduled daily brief

`POST /api/cron/daily-brief` with header `Authorization: Bearer <JARVIS_CRON_SECRET>`
generates (idempotently, one per org per day) the PRIME brief.

`vercel.json` in the app directory:

```json
{
  "crons": [{ "path": "/api/cron/daily-brief", "schedule": "0 6 * * *" }]
}
```

Vercel Cron sends GET by default for crons without a body; this endpoint
requires POST + the bearer secret, so prefer an external scheduler (e.g.
GitHub Actions, cron-job.org) that can send the header, or a Vercel cron
hitting a thin GET wrapper you add deliberately. Do not remove the secret
check to make a scheduler happy.

## Security headers

Set globally in `next.config.ts` (CSP, X-Frame-Options DENY, nosniff,
Referrer-Policy, Permissions-Policy). `robots` is `noindex` — this is a
private tool.
