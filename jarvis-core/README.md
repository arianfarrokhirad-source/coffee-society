# JARVIS — Private Multi-Business AI Operating System

> **Naming:** **Farrokhirad** is the company/product name — it appears on the
> Vercel project, deployment URLs and domains. **JARVIS** is the internal
> operating system that powers it: the Kernel, AI runtime, agents, packages
> (`@jarvis/*`), environment variables (`JARVIS_*`) and database objects keep
> their JARVIS names and are not rebranded.

JARVIS is a private command centre for one founder (**PRIME**) running multiple
businesses (A00 ATLAS … A08 VOID) from a single interface: structured company
data in Supabase, an AI orchestrator (JVS-00) that routes requests to
business-scoped specialist agents across Anthropic and OpenAI, and a
permission/approval engine that makes restricted actions impossible to execute
without PRIME's sign-off.

**Phase 1 is a secure foundation, not an autonomous company.**

## What works today

- Supabase schema (30 tables), migrations, seed for businesses A00–A08 and 10 agents
- Supabase Auth (email/password) + one-time **setup-token PRIME bootstrap**
  (server-only token, single-use nonce, atomic claim + audit; no hard-coded emails)
- Row Level Security on every table, with an SQL verification suite
- Authority model L0–L5, roles, deny-by-default action policy
- Objectives, projects, tasks (+dependencies), decisions, notifications (P0–P3, in-app)
- Approval Centre: restricted/costly actions become pending approvals; only PRIME resolves them
- JARVIS chat: deterministic command set works with **zero** AI keys
  (`Show my pending approvals`, `Review A01 performance`, `Create a task for FORGE to …`,
  `Compare current project risks`, `Generate today's PRIME brief`); free-form requests use
  the model router when keys are configured
- AI provider router: Anthropic + OpenAI adapters, env-configured models, cross-provider fallback,
  Zod-validated structured outputs, full run/tool/usage logging
- Daily PRIME brief (MONEY / THREATS / OPPORTUNITIES / APPROVALS / TODAY'S PRIORITY / SYSTEM HEALTH),
  manual button + authenticated cron endpoint
- Append-only audit log (delete/update blocked at the database level, even for the service role)
- FORGE (A01) pilot tables: leads, clients, website_audits, proposals, website_projects, maintenance_plans
- External integration adapters (Composio, Firecrawl, Relay, Manus, Hedra, Lindy, Obsidian) —
  present, typed, and **disabled**

## Current limitations (honest list)

- No document upload UI yet (metadata, classification, versioning and search are ready;
  Storage wiring is documented but not built)
- No client portal; the `client` role has no access by design
- Approving an approval records the decision; there are no executors for external actions yet
- Notifications are in-app only (delivery adapter interface exists; no email/push/Telegram)
- No autonomous anything: no trading, banking, customer messaging or publishing
- Model-backed routes need API keys + `JARVIS_MODEL_*` set; nothing is hard-coded
- Response streaming is not implemented (structured JSON replies)

## Required accounts

- [Supabase](https://supabase.com) (free tier is fine)
- [Vercel](https://vercel.com) for deployment (optional for local use)
- [Anthropic](https://console.anthropic.com) and/or [OpenAI](https://platform.openai.com)
  API keys (optional — chat commands work without them)

## Local setup

```bash
cd jarvis-core
npm install
cp .env.example apps/command-center/.env.local   # fill in Supabase values
npm run dev                                       # http://localhost:3000
```

Database: create a Supabase project, then run `supabase/migrations/0001…0008` in
order followed by `supabase/seed/seed.sql` (SQL editor or `psql`). Details:
[docs/setup/supabase.md](docs/setup/supabase.md).

First login: set `JARVIS_PRIME_SETUP_TOKEN` (min 32 chars,
`openssl rand -base64 32`), create an account at `/login`, then enter the token
under **Claim PRIME** on the Executive page. This works exactly once; remove or
rotate the token afterwards. Full deployment order:
[docs/setup/supabase.md](docs/setup/supabase.md).

## Environment variables

See [.env.example](.env.example). `NEXT_PUBLIC_*` values are safe for the
browser; everything else is server-only. Never commit `.env.local`.

## Commands

```bash
npm run dev          # run the Command Centre locally
npm run build        # production build
npm run typecheck    # packages + app
npm run lint         # eslint
npm run test         # vitest (95 unit tests)
npm run validate     # typecheck + lint + test + build
```

RLS verification (against a migrated database):
run `supabase/tests/rls_verification.sql` in the SQL editor — every check
raises on failure. For a local PostgreSQL dry-run, apply
`supabase/tests/local_harness.sql` first.

## Deployment

Vercel: project name `Farrokhirad`, root directory
`jarvis-core/apps/command-center`, plus the environment variables above. Wire `POST /api/cron/daily-brief` (Bearer `JARVIS_CRON_SECRET`)
to Vercel Cron for scheduled briefs. Details: [docs/setup/vercel.md](docs/setup/vercel.md).

## Documentation

| Area         | Docs                                                                                                                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup        | [local-development](docs/setup/local-development.md) · [supabase](docs/setup/supabase.md) · [vercel](docs/setup/vercel.md)                                                                                                                        |
| Architecture | [system-overview](docs/architecture/system-overview.md) · [ai-routing](docs/architecture/ai-routing.md)                                                                                                                                           |
| Security     | [security-model](docs/security/security-model.md) · [permissions](docs/security/permissions.md)                                                                                                                                                   |
| Operations   | [adding-a-business](docs/operations/adding-a-business.md) · [adding-an-agent](docs/operations/adding-an-agent.md) · [adding-an-integration](docs/operations/adding-an-integration.md) · [incident-response](docs/operations/incident-response.md) |

## Repository layout

```
jarvis-core/
├── apps/command-center     # Next.js 15 App Router UI + API routes
├── packages/
│   ├── shared              # constants, Zod schemas, Result type
│   ├── permissions         # authority model, action policy, agent scope
│   ├── security            # redaction, audit events, rate limit, webhooks
│   ├── database            # typed rows, clients, JarvisStore (supabase + memory)
│   ├── ai                  # provider adapters, router, structured output
│   ├── workflows           # classifier, tool pipeline, JVS-00 orchestrator
│   ├── reporting           # daily brief, notification delivery adapters
│   ├── integrations        # external adapter contract (all disabled)
│   └── ui                  # shared UI primitives
├── agents/                 # master constitution + versioned role cards
├── supabase/               # migrations, seed, RLS verification
└── docs/
```
