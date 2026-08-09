---
type: adr
id: ADR-0001
title: The vault lives inside this repository
status: proposed
date: 2026-08-08
tags: [knowledge, obsidian, process]
---

# ADR-0001 — The vault lives inside this repository

## Context

`docs/OBSIDIAN.md` §6 recorded an open blocker: the vault has to live
somewhere, and the choice has consequences that are hard to reverse once
notes accumulate. Three options were on the table — inside this
repository, a separate repository, or a synced folder outside git.

The vault holds reviewed human knowledge: decisions, procedures, business
context. It is authored by people and read by both people and agents.
Unlike Graphify's index it cannot be regenerated; losing it loses
something no one can reconstruct.

Implementation of the vault layer was approved in the Knowledge Layer
sprint, which forced the location question rather than leaving it open.

## Decision

The vault lives at `jarvis-core/farrokhirad-vault/`, inside this
repository, with its path configurable via `JARVIS_VAULT_PATH` for any
deployment that needs it elsewhere.

## Consequences

Makes easy:

- Review. A note change arrives as a diff in a pull request, which is
  exactly the human-in-the-loop step the vault design requires.
- Backup. The vault inherits git history and every existing remote.
- Atomicity. A decision and the code implementing it can land in one
  commit, so an ADR cannot silently describe code that was never merged.

Makes hard:

- Obsidian's own sync is not used, so editing on a phone means editing
  through a git client.
- The repository grows with prose that most contributors will not read.

Forecloses:

- Sharing the vault with a non-technical author who will not use git.
  If that becomes a requirement this decision has to be revisited — and
  revisiting means a new ADR that supersedes this one, not an edit here.

Accepted cost: the identity-data guard becomes more important, not less.
Anything committed here is in git history permanently, and history is
far harder to scrub than a file.

## Alternatives considered

**Separate repository.** Cleaner separation, and non-code contributors
would not see application code. Rejected because it splits review across
two pull requests and makes "the ADR and the commit that implements it"
two separate events that can diverge.

**Synced folder outside git (iCloud/Dropbox/Obsidian Sync).** Best
authoring experience, real mobile editing. Rejected because it has no
review step at all — the vault's value rests on a human vouching for
content, and a folder that syncs silently has no place to vouch.

**Supabase table.** Queryable and RLS-scoped. Rejected because it makes
the notes invisible to Obsidian, which is the tool the design is built
around, and prose in a database row is prose nobody edits.
