# Vercel deployment

## Naming convention

- **Farrokhirad** — the company/product name. Use it for the Vercel project,
  deployment URLs, domains and anything customer- or operator-facing.
- **JARVIS** — the internal operating system (Kernel, AI runtime, agents,
  packages, database objects). Internal names are **not** rebranded: package
  names stay `@jarvis/*`, env vars stay `JARVIS_*`, agent codes stay `JVS-00`,
  `A00-GM`, etc.

Rule of thumb: if a human outside engineering reads it, it says Farrokhirad;
if it is code, config keys or architecture, it says JARVIS.

## Project settings

- **Project name**: `Farrokhirad`
- **Root Directory**: `jarvis-core/apps/command-center`
- Framework preset: Next.js (auto-detected)
- Node.js 20+

The Vercel project name is stored in Vercel's project settings, not in the
repository — the `name` field in `vercel.json` was deprecated and removed by
Vercel, so there is no config file in this repo that sets it. Renaming is a
dashboard action (see below).

## Renaming an existing Vercel project

1. Vercel → the project → **Settings → General → Project Name** → `Farrokhirad` → Save.
2. Deployment URLs change from `<old-name>-*.vercel.app` to
   `farrokhirad-*.vercel.app`. Vercel keeps the previous production alias
   working, but **preview URLs generated before the rename are not renamed** —
   update any bookmarks, webhook targets or docs that pinned an old URL.
3. If a custom domain is attached it is unaffected.
4. Environment variables, the connected Git repository and build settings are
   preserved by a rename — no redeploy is required for the rename itself,
   though the next push will build under the new name.
5. The GitHub repository name is independent of the Vercel project name.
   Renaming the repo is optional and, if done, requires updating git remotes.

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
