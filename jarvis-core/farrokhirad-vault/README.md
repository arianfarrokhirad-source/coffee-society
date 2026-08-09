---
type: reference
title: Vault README
date: 2026-08-08
---

# Farrokhirad vault

Reviewed human knowledge: decisions, procedures, business context,
learning. Open this folder as an Obsidian vault, or read it as plain
markdown — every note is a file with YAML frontmatter and nothing else.

Location is fixed by [[ADR-0001]] and overridable with
`JARVIS_VAULT_PATH`.

## The boundary against Graphify

> If deleting it loses nothing but time, it belongs in Graphify.
> If deleting it loses something no one can reconstruct, it belongs here.

Graphify indexes code — files, symbols, imports, call edges — and rebuilds
itself from the repository in about a hundred milliseconds. It answers
_what_ and _where_.

This vault answers _why_, and nothing else answers it. Do not put
generated call graphs, file inventories or symbol lists here; a second
copy of Graphify's output would disagree with the repository the first
time code changed and the note did not.

## Folders

| Folder           | Holds                                  |
| ---------------- | -------------------------------------- |
| `00-inbox/`      | unreviewed capture; nothing stays here |
| `10-decisions/`  | ADRs, one file per decision            |
| `20-sops/`       | standard operating procedures          |
| `30-businesses/` | per-business operational knowledge     |
| `40-learning/`   | engineering concept notes              |
| `50-ceo/`        | strategy, priorities, reflections      |
| `60-reference/`  | external material worth keeping        |
| `99-archive/`    | superseded, never deleted              |

Folders are coarse on purpose. Links and tags carry the real structure —
deep hierarchies fight Obsidian's linking model rather than helping it.

## Rules

- **Frontmatter is mandatory.** `type` at minimum; a note without it is
  invisible to retrieval and `vault:check` reports it as an error.
- **Accepted ADRs are immutable.** Changing your mind creates a new ADR
  that supersedes the old one. Editing an accepted decision destroys the
  evidence of what was known at the time, which was the point of writing
  it down.
- **Every SOP carries an owner and a review date.** An unreviewed SOP is
  a liability precisely because it looks authoritative — people follow it.
- **Supersede, don't delete.** Move to `99-archive/`, set
  `status: superseded`, link forward.
- **No identity data. Ever.** No names, emails, phone numbers, dates of
  birth, account numbers or credentials. Supabase is the only store for
  those; reference individuals by their Supabase identifier. This is
  enforced on both write and read, but the enforcement is a backstop —
  the control is not writing it in the first place. Anything committed
  here is in git history permanently.
- **Agents capture, humans promote.** Agent writes land in `00-inbox/`
  as `status: unreviewed` and cannot mark themselves reviewed. If agents
  wrote reviewed knowledge directly, this vault would become a second
  derived cache and its only advantage over Graphify — that a human
  vouched for it — would be gone.

## Commands

Run from `jarvis-core/`:

```
npm run vault:check              validate every note
npm run vault:search -- "mtime"  search, with provenance
npm run vault:list -- adr        list notes of one type
```

`vault:check` runs in CI and fails the build on errors. Warnings — a
wikilink pointing at nothing, a date in the future — are reported but do
not block a merge.
