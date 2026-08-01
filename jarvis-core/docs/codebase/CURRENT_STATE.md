<!--
Type: manual
Canonical for: project state, active approvals, blockers  ← THE source of truth
Update when: every commit checkpoint, approval, or scope change
Owner: PRIME
-->

# Current state

**Read this first, every session.** Last updated: 2026-08-01, commit `65ca4d0`.

## Where we are

|                           |                                                                    |
| ------------------------- | ------------------------------------------------------------------ |
| **Product / OS**          | Farrokhirad (product) · JARVIS (internal OS)                       |
| **Phase**                 | Phase 1.1 — Foundation Hardening                                   |
| **Active branch**         | `claude/jarvis-phase-1-1-hardening` (PR #3)                        |
| **Frozen baseline**       | `b4cd2f1` — tag `jarvis-phase-1-audit` (local; remote tag pending) |
| **Last commit**           | `65ca4d0` — `chore(branding)`: Vercel project named Farrokhirad    |
| **Last hardening commit** | `1cf3741` — commit 1/16: setup-token PRIME bootstrap               |
| **CI**                    | green on PR #1 (frozen baseline) and PR #3 (active)                |
| **Deployed**              | no — never run against a live Supabase project                     |

## Work currently approved

- **Phase 1.1 commit 2 — fail-closed critical auditing.** Design not yet
  submitted; requires PRIME approval of the technical design before code.
- **JEKS Slice 2** — manifest schema, generator, verifier, generated catalogs,
  npm scripts. (Slice 1 complete.)

## Work currently prohibited

- **Phase 2 product features** of any kind.
- **External execution**: Firecrawl, Composio, Relay, Manus, Hedra, Lindy,
  Obsidian sync, customer messaging, publishing, banking, trading, payments,
  voice, vector memory, multi-agent autonomy, Business 9.
- **JEKS Slice 3** (`SECURITY_MAP`, `DATABASE_MAP`, `AI_RUNTIME_MAP`,
  `EVENT_CATALOG`, `DEVELOPMENT_PLAYBOOK`, ADRs) — deferred until after
  hardening commit 10, because authorization, definitions, orchestrator layout
  and store interfaces all still change.
- **Refactoring code into a kernel package.** The kernel is a documented
  concept, not a module. Do not create it during hardening.
- **Modifying the frozen baseline branch** `claude/jarvis-phase-1-5lq25b`.
- **Editing `/audit-package/*`** — frozen evidence with SHA-256 manifest.

## Change-control protocol in force

Hardening proceeds one commit at a time: technical design → PRIME approval →
implement → validate → `HARDENING CHECKPOINT` → **stop** → approval. Commits
are not batched. Sequence: 1 ✅ · 2 auth-audit · 3 scope FKs · 4 RLS perf ·
5 authz source · 6 definition dedup · 7 Supabase CLI + types · 8 events ·
9 orchestrator split · 10 store segregation · 11 conversation memory ·
12 AI budgets · 13 rate limit + webhooks · 14 observability · 15 cleanup ·
16 docs + final validation.

## Known blockers

| Blocker                                      | Owner             | Impact                                                      |
| -------------------------------------------- | ----------------- | ----------------------------------------------------------- |
| Vercel project rename to `Farrokhirad`       | PRIME (dashboard) | cosmetic; repo side done                                    |
| Remote git tag `jarvis-phase-1-audit`        | PRIME             | this environment's credentials refuse tag pushes (HTTP 403) |
| No live Supabase project                     | PRIME             | RLS/Storage/auth verified only on local PG16 + harness      |
| No Docker / Supabase CLI in this environment | environment       | Playwright E2E cannot be fully executed here                |

## Required next approval

1. Review of JEKS Slice 1 (this system) → then Slice 2.
2. Technical design for hardening commit 2 → then implementation.

Open question carried forward: should `ARCHITECTURE_EVOLUTION.md` move from
Slice 3 into Slice 2? Its content (current choice → replacement trigger →
candidate → migration cost) is stable today and it is the main defence against
"temporary" becoming permanent.

## Validation commands

```bash
cd jarvis-core
npm ci && npm run lint && npm run typecheck && npm run test && npm run build
# database (fresh PostgreSQL 16 + Supabase-runtime harness):
#   supabase/tests/local_harness.sql → migrations 0001-0009 → seed
#   → supabase/tests/rls_verification.sql
#   → supabase/tests/prime_bootstrap_verification.sql
#   → supabase/tests/race_prime_claim.sh
```

Current results: 116/116 unit tests · lint clean · typecheck clean · build
clean · RLS 8/8 · PRIME bootstrap 12/12 · race test pass.
