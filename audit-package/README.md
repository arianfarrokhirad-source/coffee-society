# ⛔ FROZEN AUDIT ARTIFACT — not maintained

This directory is a **point-in-time snapshot** produced for the independent
Phase 1 audit at commit `b4cd2f1d37e473a31f3a1eaf8398b5d5427f8e93`
(tag `jarvis-phase-1-audit`, 2026-08-01).

**Do not edit these files.** `MANIFEST.md` records a SHA-256 checksum for every
file in the snapshot; editing any of them invalidates the audit evidence.
Nothing here is updated as the codebase changes, so treat every statement in
this directory as _true on 2026-08-01 and possibly stale now_.

## Current documentation lives here instead

**`jarvis-core/docs/codebase/`** — the JARVIS Engineering Knowledge System
(JEKS). Start with `jarvis-core/docs/codebase/CURRENT_STATE.md`.

| Frozen file here                   | Living successor                                                           |
| ---------------------------------- | -------------------------------------------------------------------------- |
| `ARCHITECTURE.md`, `CODE_INDEX.md` | `docs/codebase/SYSTEM_MAP.md` + generated catalog _(Slice 2)_              |
| `DATABASE.md`                      | `docs/codebase/context/DATABASE_CONTEXT.md`, `DATABASE_MAP.md` _(Slice 3)_ |
| `SECURITY.md`                      | `docs/codebase/context/SECURITY_CONTEXT.md`, `SECURITY_MAP.md` _(Slice 3)_ |
| `AI.md`                            | `docs/codebase/context/AI_CONTEXT.md`, `AI_RUNTIME_MAP.md` _(Slice 3)_     |
| `APPLICATION.md`                   | `docs/codebase/context/FRONTEND_CONTEXT.md`                                |
| `KNOWN_ISSUES.md`, `NEXT_PHASE.md` | `ARCHITECTURE_EVOLUTION.md` _(pending)_                                    |
| `TESTING.md`, `DEPLOYMENT.md`      | `DEVELOPMENT_PLAYBOOK.md` _(Slice 3)_ + `docs/setup/`                      |

`audit-package.zip` is the distributable form of this snapshot and is likewise
frozen. This notice postdates the manifest and is deliberately not listed in it.
