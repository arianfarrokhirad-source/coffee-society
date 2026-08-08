<!--
Type: manual
Canonical for: how to use JEKS (nothing else)
Update when: the session protocol or document set changes
Owner: PRIME
-->

# JARVIS Engineering Knowledge System (JEKS)

JEKS exists so a fresh Claude Code session or a new engineer can act correctly
on a specific task after reading **~150 lines**, not 150 files.

It is **not** a source of truth for anything except current project state and
architectural decisions. Everything else here explains and links; the code,
migrations and generated types remain canonical.

Product naming: **Farrokhirad** is the company/product. **JARVIS** is the
internal operating system described here. Internal names are never rebranded.

## Session startup protocol

Read in this order, stopping as soon as you have enough:

1. **`CURRENT_STATE.md`** — always. Phase, baseline, what is approved and
   prohibited right now. (~60 lines)
2. **One `context/*_CONTEXT.md`** matching your task domain. (~150 lines each)
3. **Governing ADRs** named by that packet — only if your change touches them.
   (`decisions/`, arriving in Slice 3)
4. **The source files you are changing, and their tests.**

Do **not** load the whole `docs/` tree, `/audit-package`, or generated
catalogs in full. Generated catalogs are for grepping, not reading.

`SYSTEM_MAP.md` is read only when a change crosses a component boundary.
`GLOSSARY.md` is a lookup — grep it for a term, do not read it end to end.

## Context budgets

Always choose the **smallest sufficient** context.

| Tier     | Budget         | Use for                                                             |
| -------- | -------------- | ------------------------------------------------------------------- |
| Tiny     | ≤ ~200 lines   | a scoped change inside one module; `CURRENT_STATE` + one packet     |
| Standard | ≤ ~800 lines   | a change touching two components; + `SYSTEM_MAP` + relevant source  |
| Extended | ≤ ~3,000 lines | cross-cutting refactors, security review; + migrations, ADRs, tests |

Escalate deliberately. If you are at Extended without a cross-cutting reason,
you are reading too much.

## Task context template

Copy `context/TASK_TEMPLATE.md` into the task brief and fill it before
changing code. It is what keeps a session inside its approved scope.

## Document index

| Document                                                                             | Type      | Canonical for                                      |
| ------------------------------------------------------------------------------------ | --------- | -------------------------------------------------- |
| `CURRENT_STATE.md`                                                                   | manual    | **yes** — project state, approvals, blockers       |
| `SYSTEM_MAP.md`                                                                      | manual    | no — explains the kernel and boundaries            |
| `GLOSSARY.md`                                                                        | manual    | no — term lookup                                   |
| `context/*_CONTEXT.md`                                                               | manual    | no — per-domain working knowledge                  |
| `context/TASK_TEMPLATE.md`                                                           | manual    | no — scope discipline                              |
| `ENGINEERING_PRINCIPLES.md`                                                          | manual    | **yes** — engineering philosophy                   |
| `ARCHITECTURE_EVOLUTION.md`                                                          | manual    | **yes** — temporary choices + replacement triggers |
| `MANIFEST.json`                                                                      | generated | no — navigation metadata                           |
| `CATALOG.generated.md`                                                               | generated | no — modules, routes, tools, dependency graph      |
| `decisions/ADR-*.md`                                                                 | manual    | **yes** — decision history _(Slice 3)_             |
| `EVENT_CATALOG.generated.md`                                                         | generated | no — event producers, guarantees, security class   |
| `SECURITY_MAP.md`, `DATABASE_MAP.md`, `AI_RUNTIME_MAP.md`, `DEVELOPMENT_PLAYBOOK.md` | mixed     | _(Slice 3)_                                        |

## Update contract

Every file carries a header stating its type, what it is canonical for, and
when to update it. Rules:

- **Generated files are never hand-edited.** Run `npm run codebase:generate`
  (Slice 2). Human judgement lives in an annotations file the generator merges.
- **`CURRENT_STATE.md` is updated at every checkpoint** — it is the one file
  guaranteed to be current.
- **Manual documents explain intent, constraints and procedure.** If a
  statement can be derived from code, it belongs in a generated file instead.
- **Never describe desired architecture as if it exists.** Current reality
  first; intended direction explicitly labelled as such.

**Avoid documentation churn.** Each document has exactly one trigger:

| Document                    | Changes only when                                 |
| --------------------------- | ------------------------------------------------- |
| `CURRENT_STATE.md`          | project state changes (commit, approval, blocker) |
| `SYSTEM_MAP.md`             | architecture changes                              |
| `ARCHITECTURE_EVOLUTION.md` | a temporary architectural decision changes        |
| `ENGINEERING_PRINCIPLES.md` | a principle is added or retired (rare)            |
| `context/*`                 | that domain's rules, modules or invariants change |
| generated files             | `npm run codebase:generate` — never by hand       |

If a change does not match a trigger, do not touch the document.

## Tooling

```bash
npm run codebase:generate   # rewrite MANIFEST.json + both generated catalogs
npm run codebase:verify     # advisory checks (--strict to exit non-zero)
```

`verify` checks: referenced paths exist · security-critical files have required
tests · generated files are not stale · security-shaped files are all
classified · module dependencies obey `layerRules` · business/agent codes match
between the seed and TypeScript constants · doc links resolve · context packets
are within budget · no secret-shaped strings · no circular module dependencies ·
every event in code is annotated · referenced ADRs exist · every
`ARCHITECTURE_EVOLUTION` row has all seven cells · `CURRENT_STATE` commit
references are real.

It verifies **structure, not truth**: green means paths resolve and generated
content is fresh, not that the prose is accurate. Advisory until Slice 3 is
accepted, then `--strict` becomes the default and it joins `npm run validate`.

Tools live in `tools/codebase/` and run on Node's native TypeScript support —
no build step and no added dependency. Human judgement lives in
`tools/codebase/annotations.json`; the generator merges it and never
overwrites it.

## Related documentation (not part of JEKS)

- `../setup/` — Supabase, local development, Vercel deployment procedures.
- `../security/`, `../operations/` — living procedure docs; folded into
  JEKS in Slice 3.
- `/audit-package/` — **frozen** point-in-time audit artifact. Not maintained.
