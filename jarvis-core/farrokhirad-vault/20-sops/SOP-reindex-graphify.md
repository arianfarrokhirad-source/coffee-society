---
type: sop
title: Re-index Graphify after a repository change
owner: engineering
lastReviewed: 2026-08-08
reviewCycle: quarterly
tags: [graphify, operations]
---

# SOP — Re-index Graphify after a repository change

## When this applies

Routine changes need no action: CI runs the indexer on every push and PR.
Follow this when working locally and wanting a current index, or when
the index is suspected to be wrong.

## Prerequisites

- Dependencies installed (`npm ci`) from `jarvis-core/`.
- No API key needed. The structural index is free, offline and
  deterministic; only the semantic pass costs money and it is opt-in.

## Steps

1. Run `npm run graph` from `jarvis-core/`.
2. Read the change line: `+added ~modified -deleted (n unchanged)`.
3. Confirm the health line reads `HEALTHY`.
4. If it reads `DEGRADED`, read the issues block before continuing.
5. Run `npm run graph` a second time and confirm it reports `No changes`.

## Verification

The second run must report `No changes` and re-extract nothing. If it
re-extracts on an unchanged tree, change detection is broken — see
[[ADR-0002]] for why hashes rather than timestamps are used, and treat a
repeated full extraction as a defect rather than as slowness.

## Failure modes

**`DEGRADED` with broken relative imports.** A relative import resolves
to no file. Usually a rename that missed a reference. Fix the import;
this also fails CI via `npm run graph -- --strict`.

**`DEGRADED` with import cycles.** Two modules import each other. Break
the cycle by moving the shared piece into its own module. Cycles defeat
tree-shaking and make initialisation order matter.

**`STALE`.** No completed run within 24 hours. Re-run the indexer; this
is not a code problem.

**Recovered from an incomplete previous run.** The last run was killed
mid-write. The next run repairs it automatically — no action beyond
letting it finish.

**A full re-extract on an unchanged tree.** Either `--force` was passed,
or the stored index version no longer matches the code. Both are
expected after an indexer upgrade and cost one run.

## Escalation

Persistent `DEGRADED` after fixing the reported issues, or an index that
disagrees with the repository, is an indexer defect rather than a
repository problem. Capture the output and raise it with engineering —
do not work around it by deleting the index repeatedly, which hides the
signal.
