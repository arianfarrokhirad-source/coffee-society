---
type: adr
id: ADR-0002
title: Graphify detects change by content hash, not mtime
status: proposed
date: 2026-08-08
tags: [graphify, indexing]
---

# ADR-0002 — Graphify detects change by content hash, not mtime

## Context

Graphify re-indexes the repository on every push. The expensive parts of
a run are extraction and embedding, so the run has to know which files
actually changed. Modification time is the obvious signal: it is already
on disk, free to read, and every build tool uses it.

## Decision

Change detection compares a content hash (FNV-1a, 32-bit) of each file
against the hash stored in the index. `mtime` is not consulted.

## Consequences

Makes easy:

- Correct behaviour in CI. A fresh checkout sets every `mtime` to now,
  so an mtime-based index would re-extract the entire repository on
  every single build — the exact cost the index exists to avoid.
- Correct behaviour across branches. `git checkout` of an older branch
  moves `mtime` backwards, so a genuine change reads as no change and
  the index serves stale data with no signal that it is wrong.
- Touching a file without editing it costs nothing.

Makes hard:

- Every candidate file must be read on every run, where `mtime` needs
  only a `stat`. Measured at ~100ms for 173 files, which is negligible
  next to one extraction call.

Accepted cost: FNV-1a is not cryptographic. A collision causes a file to
be skipped when it should have been re-indexed. At 32 bits over a few
hundred files this is remote, and the failure is a stale entry rather
than a security problem. Revisit if the corpus reaches tens of
thousands of files.

## Alternatives considered

**mtime.** Rejected for the two failure modes above. Both are silent,
which is what makes them worse than a slow run.

**mtime plus size.** Cheaper, and catches most edits. Rejected because
it still inherits the checkout problem, and a same-size edit — changing
a comparison operator, swapping two identifiers — is precisely the kind
of change that matters.

**git status.** Accurate and fast, and rejected because it ties the
indexer to git being present and the working tree being clean. The
indexer should work on any directory of files.

**SHA-256.** Collision-free in practice. Rejected as unnecessary: this
answers "did this file change?", not "is this file authentic". FNV-1a
needs no dependency and is faster.
