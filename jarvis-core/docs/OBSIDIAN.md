# Obsidian — Farrokhirad Human Knowledge Base

Status: **design**. No vault exists yet. This document specifies structure,
conventions and the retrieval interface, so the vault can be created without
re-litigating its shape.

---

## 1. Purpose and boundary

The vault holds **reviewed human knowledge**: decisions, reasoning, procedures,
business context, and learning. It is authored by people, reviewed by people, and
read by both people and agents.

The boundary against Graphify, stated as a test rather than a slogan:

> If deleting it loses nothing but time, it belongs in Graphify.
> If deleting it loses something no one can reconstruct, it belongs in Obsidian.

Code structure is re-derivable from code. *Why* a boundary was drawn is not — it
exists only in someone's head until it is written down. That asymmetry is the
whole justification for the vault.

| | Graphify | Obsidian |
| --- | --- | --- |
| Authored by | extraction | humans |
| Rebuildable | yes | no |
| Answers | what/where | why |
| On conflict with repo | repo wins | vault records intent; investigate the divergence |

Do not duplicate: the vault should not contain generated call graphs, file
inventories, or symbol lists.

## 2. Vault structure

```
farrokhirad-vault/
├── 00-inbox/            unsorted capture; nothing stays here
├── 10-decisions/        ADRs — one file per decision
├── 20-sops/             standard operating procedures
├── 30-businesses/
│   ├── A00-holding/
│   ├── A01-.../         one folder per business code
│   └── ...
├── 40-learning/         PRIME's engineering notes
├── 50-ceo/              CEO notes: strategy, priorities, reflections
├── 60-reference/        external material worth keeping
└── 99-archive/          superseded, never deleted
```

Numeric prefixes give a stable sort and a stable mental model. Folders are
coarse; **links and tags carry the real structure** — this is what Obsidian is
good at, and fighting it with deep hierarchies wastes the tool.

## 3. Note types

### ADR — Architecture Decision Record

`10-decisions/ADR-NNNN-short-title.md`

```markdown
---
type: adr
id: ADR-0001
status: proposed | accepted | superseded
date: 2026-08-07
supersedes: ADR-0000
commit: <sha, when the decision landed in code>
tags: [security, database]
---

# ADR-0001 — Title

## Context
What was true that forced a decision. Constraints, not narrative.

## Decision
What we chose. Present tense, active voice.

## Consequences
What this makes easy, what it makes hard, what it forecloses.
Include the bad ones — an ADR with only upsides was not a decision.

## Alternatives considered
What was rejected and why. This is the section future readers actually need.
```

ADRs are **immutable once accepted**. Changing your mind creates a new ADR that
supersedes the old one; the old one stays. An edited decision record loses the
one thing it was for — evidence of what was known at the time.

### SOP — Standard Operating Procedure

`20-sops/SOP-name.md`

```markdown
---
type: sop
owner: <role>
last_reviewed: 2026-08-07
review_cycle: quarterly
---

# SOP — Name

## When this applies
## Prerequisites
## Steps          ← numbered, imperative, one action each
## Verification   ← how you know it worked
## Failure modes  ← what commonly goes wrong and what to do
## Escalation     ← who to involve when it does
```

Every SOP carries a review date. An unreviewed SOP is a liability: people follow
it precisely because it looks authoritative.

### Business knowledge

`30-businesses/<code>/` — operations, suppliers, customers-as-segments, pricing
logic, seasonal patterns, local regulation.

**Prohibited here as everywhere in the vault:** passwords, authentication tokens,
phone numbers, birth dates, sex, or other identity data. Business *facts* only.
Individuals are referenced by their Supabase identifier, never by personal
detail.

### Learning notes

`40-learning/` — PRIME's engineering development. One concept per note, linked to
the work that prompted it. The `## For PRIME` sections in these architecture
documents are the raw material.

### CEO notes

`50-ceo/` — strategy, priorities, reflections, decisions not yet formal enough
for an ADR. Deliberately lower-ceremony: friction here means things go unrecorded.

## 4. Conventions

- **Frontmatter is mandatory** — `type` at minimum. It is the only thing that
  makes programmatic retrieval possible.
- **Links over folders.** `[[ADR-0001]]` beats a directory hierarchy.
- **One idea per note.** Notes that accumulate unrelated content stop being
  findable.
- **Dates are ISO 8601.** No ambiguity between locales.
- **Supersede, don't delete.** Move to `99-archive/`, set `status: superseded`,
  link forward.

## 5. Retrieval interface

The vault must be queryable by agents without a human relaying content.
Requirements:

| Requirement | Detail |
| --- | --- |
| Read-only by default | Agents read; writes go through human review |
| Frontmatter-filtered | Query by `type`, `tags`, `status`, `last_reviewed` |
| Full-text + semantic | Exact match for known IDs, semantic for "why did we…" |
| Provenance in results | Every result returns file path, `type`, and date so the caller can judge freshness |
| Deny-list enforced | Retrieval refuses to return anything matching identity-data patterns, as defence in depth |

The interface sits behind the Router (`MEMORY_ARCHITECTURE.md` §5) at precedence
2 — consulted after Graphify for structural questions, before Supabase for
"why" questions.

**Agent writes require a human in the loop.** If agents write to the vault
unreviewed, it becomes a second derived cache and the Graphify boundary in §1
collapses. Suggested pattern: agents write to `00-inbox/` with
`status: unreviewed`; a human promotes.

## 6. Blockers

1. **No vault exists.** Creating one is a decision about *where it lives* —
   inside this repository, a separate repository, or a synced folder outside git.
   That is PRIME's call and it has real consequences for review flow and backup.
2. **The memory-architecture rule still defers implementation** to the
   conversation-memory phase after hardening. This document is design, which is
   permitted; creating and populating the vault is implementation, which is not
   yet approved.
3. Retrieval interface depends on the Router, which is unbuilt.

---

## For PRIME — what to take from this

**What was built:** a vault specification — structure, note types, conventions,
and a retrieval contract.

**Why it exists:** decisions and reasoning have no other home. Code records what;
only prose records why.

**Concepts involved:** *ADRs* as immutable decision records; *Zettelkasten*
influence (atomic notes, links over hierarchy); *structured frontmatter* as the
machine-readable surface of human prose; *human-in-the-loop* as the property that
keeps an authored store from degrading into a cache.

**Industry practice:** ADRs are standard in serious engineering organisations —
Nygard's format, ThoughtWorks' adoption. The key discipline is immutability:
teams that edit accepted ADRs lose the historical record within a year.

**Common mistakes:** deep folder hierarchies that fight the linking model;
SOPs without review dates; letting agents write unreviewed and turning the vault
into a low-quality cache; recording only successful decisions, so the archive
teaches nothing about judgement.

**Further reading:** Michael Nygard, *Documenting Architecture Decisions* (2011);
Sönke Ahrens, *How to Take Smart Notes* — the reasoning behind atomic, linked
notes.
