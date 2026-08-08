# JARVIS Memory Architecture

Status: **design**. Nothing described below the Supabase layer is implemented yet.
Authority: PRIME, 2026-08-07. Supersedes nothing; extends the standing
memory-architecture rule in `codebase/context/SECURITY_CONTEXT.md`.

---

## 1. The layers, and why there are several

A single store cannot serve all four jobs a system like JARVIS needs, because the
jobs have contradictory requirements:

| Job                                           | Needs                                               | Wrong store for it                                     |
| --------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------ |
| "What is true right now, and who may see it?" | Transactions, constraints, row-level authorization  | A graph or a folder of notes — neither can enforce RLS |
| "How does this codebase fit together?"        | Relationships, traversal, cheap re-derivation       | A relational table — you'd hand-roll recursive joins   |
| "What did we decide, and why?"                | Human-authored prose, durable, reviewable, diffable | A database — nobody reviews a row in a PR              |
| "Where is the 40 MB scan of the lease?"       | Blob storage                                        | Any of the above                                       |

So: **four stores, four jobs, one rule each about what may live there.**

```
                    ┌──────────┐
                    │  Claude  │  architecture · reasoning · verification
                    └────┬─────┘
                         │  asks for context, never scans blindly
                    ┌────▼─────────┐
                    │ Coordinator  │  decides WHAT is needed
                    └────┬─────────┘
                         │
                    ┌────▼─────┐
                    │  Router  │  decides WHERE it comes from, and WHO answers
                    └────┬─────┘
         ┌───────────┬───┴────┬─────────────┬──────────────┐
         │           │        │             │              │
   ┌─────▼────┐ ┌────▼────┐ ┌─▼────────┐ ┌──▼──────────┐
   │ Graphify │ │Obsidian │ │ Supabase │ │Google Drive │
   │  code    │ │ human   │ │  truth   │ │   blobs     │
   │  memory  │ │knowledge│ │ + identity│ │             │
   └──────────┘ └─────────┘ └──────────┘ └─────────────┘
     derived      authored     authoritative    opaque
     rebuildable  reviewed     transactional    large
```

Read the arrows as _precedence_, not as a pipeline: the Router consults cheap,
derived sources first and falls through to expensive or authoritative ones.

## 2. Layer contracts

### Graphify — code memory (derived)

- **Contains:** repository structure, symbols, call and import edges, module
  boundaries, test-to-subject links, summaries of what code does.
- **Authority:** none. It is a _cache of understanding_. If it disagrees with the
  repository, the repository wins and the graph is rebuilt.
- **May be deleted at any time** without data loss. This is the property that
  makes it safe.
- **Must never contain:** identity data, secrets, credentials, customer data,
  or anything from `auth.users` / `public.profiles`.

### Obsidian — human knowledge (authored)

- **Contains:** ADRs, SOPs, business knowledge, learning notes, CEO notes.
- **Authority:** it is the record of _decisions and intent_, which exist nowhere
  else. Code shows what was done; the vault shows why.
- **Human-reviewed.** Nothing is written to the vault by an agent without a
  human in the loop. This is what distinguishes it from Graphify.
- **Must never contain:** passwords, authentication tokens, phone numbers, birth
  dates, sex, or other identity data. Same prohibition as Graphify.

### Supabase — authoritative transactional and identity state

- **Contains:** organizations, businesses, memberships, roles, permissions, work
  items, approvals, audit logs, profiles.
- **Authority:** total. Every other layer defers to it.
- **The only layer permitted to hold identity data**, and it holds it under RLS,
  under the `handle_new_user` trigger contract, and under the append-only audit
  log.

### Google Drive — blobs

- **Contains:** documents, scans, images, exports.
- **Authority:** none over meaning; total over the bytes.
- Referenced by ID from Supabase; never mirrored into the graph or vault.

## 3. The invariant that keeps this safe

> Identity data lives in Supabase and only in Supabase.

Restating why, because it is the rule most likely to be eroded by convenience: a
graph is rebuildable and a vault is diffable, which means both are _copied_
freely — into backups, into embeddings, into a model's context window, into a
git history that is hard to purge. Supabase is the only layer with row-level
authorization and an audit trail. A phone number in the graph is a phone number
with no access control and no deletion story.

This applies to derived data too. A summary that says "user X's account was
created on date Y with phone Z" is identity data no matter how it was produced.

## 4. Retrieval precedence

When Claude needs context, the Router resolves in this order and stops at the
first layer that answers:

1. **Graphify** — structural questions about code. Cheapest, always rebuildable.
2. **Obsidian** — "why", decisions, procedures, business context.
3. **Supabase** — current state, permissions, who-can-do-what.
4. **Google Drive** — the actual document.
5. **Repository files** — the fallback and the ground truth.

Two honest notes on this order:

- Precedence is not a promise that earlier layers are _correct_ — it is a
  statement about cost. Graphify answers cheaply; the repository answers
  definitively. When a structural claim matters for a decision, verify it
  against the repository.
- Until Graphify and Obsidian exist, this list collapses to Supabase →
  repository files, and repository reads are not waste — they are the only
  source. Do not treat "don't re-read the repo" as active guidance today.

## 5. Coordinator and Router — what they actually are

Neither exists yet. When built:

- **Coordinator** answers _what context does this task need?_ It turns a task
  ("review the approval transition rules") into a context request ("the SQL
  matrix, its TypeScript mirror, and the ADR that set the policy"). It is the
  component that prevents blind repository scans.
- **Router** answers _where does that come from, and which model does the work?_
  It owns both the retrieval precedence above and the model-routing rules in
  `MODEL_ROUTING.md`. One component, two dispatch tables.

Keeping them separate matters: the Coordinator is about _sufficiency_ (did we
gather enough?), the Router is about _economy_ (did we use the cheapest adequate
source and model?). Merging them produces a component that silently trades
correctness for cost.

## 6. Failure modes to design against

| Failure                           | Consequence                                  | Mitigation                                                            |
| --------------------------------- | -------------------------------------------- | --------------------------------------------------------------------- |
| Stale graph                       | Confident wrong answers about code structure | Content-hash invalidation; graph records the commit it was built from |
| Vault drift                       | ADR says one thing, code does another        | ADRs reference commits; review catches divergence                     |
| Identity leak into graph/vault    | Uncontrolled PII with no deletion story      | Extraction denylist + review; see §3                                  |
| Router prefers cheap over correct | Plausible answers that fail under load       | Precedence is cost-ordered, not authority-ordered — §4 note           |
| Graph treated as authoritative    | Repository changes silently ignored          | Graph is derived; repository always wins                              |

## 7. Implementation status

| Layer              | Status                                                               |
| ------------------ | -------------------------------------------------------------------- |
| Supabase           | **Live.** Migrations 0001–0011 applied to staging; RLS verified      |
| Google Drive       | Adapter stub only (`packages/integrations/`), disabled in Phase 1    |
| Graphify           | **Does not exist.** See `GRAPHIFY.md` for the specification          |
| Obsidian           | **Does not exist.** See `OBSIDIAN.md` for the design                 |
| Coordinator        | Not built                                                            |
| Router (retrieval) | Not built                                                            |
| Router (model)     | Partially exists for AI providers only — `packages/ai/src/router.ts` |

---

## For PRIME — what to take from this

**What was built:** a layered memory design with one job per store and one
prohibition per store.

**Why it exists:** so that "where does this fact live?" has exactly one answer,
which is what makes the system auditable.

**Concepts involved:** _system of record_ vs _derived cache_ (the distinction
that makes Graphify safe to delete and Supabase not); _cache invalidation_;
_precedence vs authority_ (§4 — these are different orderings and conflating them
is a classic source of confident wrong answers).

**Industry practice:** this mirrors the standard split between an OLTP database,
a search/graph index, and a documentation system. The unusual part is writing the
prohibitions down as hard rules rather than conventions.

**Common mistakes:** letting the derived layer become authoritative because it is
convenient; copying identity data into a cache "just for display"; building
retrieval precedence around authority instead of cost, so every question hits the
expensive store.

**Further reading:** Martin Kleppmann, _Designing Data-Intensive Applications_,
ch. 3 and 11 (derived data, systems of record); Nygard, _Documenting Architecture
Decisions_ (the ADR format used in `OBSIDIAN.md`).
