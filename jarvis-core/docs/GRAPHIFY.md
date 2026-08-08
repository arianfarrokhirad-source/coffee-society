# Graphify — Code Memory

Status: **specification**. Graphify does not exist in this repository.

Verified 2026-08-07 in the JARVIS build environment: no `graphify-out`
directory, no Graphify source, no Graphify configuration, and no `/graphify`
command (the CLI returns `Unknown command`). The only occurrences of the string
"graphify" anywhere in the repository are in documents recording PRIME's rules.

This document therefore specifies what must be built and what "production-ready"
must mean. It does not report on a running system, and nothing in it should be
read as a status claim.

---

## 1. Purpose

Graphify is the **code memory** layer of `MEMORY_ARCHITECTURE.md`: a derived,
rebuildable graph of how the repository fits together, so that answering "what
calls this?" or "what breaks if I change this?" does not require scanning the
repository from scratch every time.

It is a cache of understanding. It has **no authority**. When it disagrees with
the repository, the repository is right.

## 2. Data model

Minimum viable node and edge types:

| Node                 | Key attributes                                                    |
| -------------------- | ----------------------------------------------------------------- |
| `file`               | path, language, content hash, size                                |
| `module` / `package` | name, workspace path, dependencies                                |
| `symbol`             | name, kind (function/class/type/const), file, line span, exported |
| `test`               | path, framework, subject under test                               |
| `migration`          | number, path, objects created/dropped                             |
| `doc`                | path, title, kind (ADR/SOP/context)                               |

| Edge         | Meaning                          |
| ------------ | -------------------------------- |
| `imports`    | file → file / module             |
| `calls`      | symbol → symbol                  |
| `defines`    | file → symbol                    |
| `tests`      | test → symbol / file             |
| `references` | doc → symbol / file / migration  |
| `supersedes` | migration → migration, doc → doc |

Every node carries the **commit SHA the graph was built from** and the **content
hash of its source**. Both are load-bearing; see §3.

## 3. Cache invalidation — the contamination problem

PRIME's directive names "cache contamination" as a known failure. Since no
Graphify instance exists here, this section specifies the invalidation model that
prevents the class of bug rather than diagnosing a specific incident.

**Contamination** is any state where the graph contains facts derived from source
that no longer exists, mixed with facts from current source, with no way to tell
which is which. It produces confidently wrong answers — the worst failure mode
for a memory layer, because a _missing_ answer prompts a re-read while a _stale_
answer does not.

Required invariants:

1. **Content-addressed entries.** Every derived fact records the SHA-256 of the
   exact source text it came from. A fact whose source hash no longer matches is
   invalid — not "probably fine".
2. **No partial-write visibility.** Build to a temporary location, then swap
   atomically. A reader must never observe a half-written graph. (`write to
graph.json.tmp` → `fsync` → `rename` — `rename(2)` is atomic within a
   filesystem.)
3. **Generation counter.** The graph carries a monotonically increasing
   generation. Readers pin a generation for the duration of a query so a
   concurrent rebuild cannot change answers mid-question.
4. **Provenance on every node.** `commit`, `source_hash`, `extracted_at`,
   `extractor_version`. When the extractor changes, previously derived facts are
   suspect and must be re-derived — an extractor version bump invalidates
   everything it produced.
5. **Explicit deletion.** Removing a file must remove its nodes and every edge
   incident to them. Orphaned edges are the most common contamination source:
   the file is gone, the `calls` edge survives, and traversal reports a caller
   that no longer exists.
6. **No cross-run mutable global state.** Each build starts from a declared
   input set. Anything an incremental run reuses must be re-validated by hash
   first, not trusted because it was there.

Invariant 5 is the one to guard hardest. It is easy to write the "add" path and
forget that deletion is not the absence of addition.

## 4. Required capabilities

| #   | Capability         | Definition of done                                                                                                                       |
| --- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Graph generation   | Full build over the repository produces a graph with every node type in §2 populated                                                     |
| 2   | Contamination-free | All six invariants in §3 hold, each with a test that fails when the invariant is removed                                                 |
| 3   | Valid `graph.json` | Conforms to a published schema; round-trips; validated in CI                                                                             |
| 4   | Semantic retrieval | Natural-language query returns relevant nodes with provenance; measured against a fixed question set with known-good answers             |
| 5   | Incremental update | Changing N files re-derives O(N + dependents), not O(repository); result is byte-identical to a full rebuild                             |
| 6   | Crash-safe resume  | Kill the process at any point during a build; the next run either resumes or restarts cleanly, and never leaves a readable corrupt graph |

Capability 5's equivalence requirement is the important one: an incremental build
that merely _looks_ right is how contamination re-enters. Assert byte-equality
against a full rebuild in CI.

## 5. Reports

PRIME requested `GRAPH_REPORT.md` and `GRAPH_HEALTH.md`. Both are **outputs of a
run**, not documents that can be authored in advance:

- **`GRAPH_REPORT.md`** — what a specific build produced: node and edge counts by
  type, coverage (files indexed / files present), extraction failures, duration,
  token and cost usage, commit SHA.
- **`GRAPH_HEALTH.md`** — whether the graph is currently trustworthy: staleness
  (commits since build), orphaned edges, nodes with stale source hashes,
  extractor-version skew, invariant check results, last successful build.

Writing either now would mean inventing measurements. They must be **generated by
the tool**, and their generation should be part of the build — a build that
cannot describe itself is not production-ready.

## 6. Definition of "production-ready"

All six capabilities in §4 demonstrated, plus:

- Deterministic: two builds of the same commit produce identical graphs.
- Bounded: memory and time scale predictably with repository size.
- Observable: every build emits `GRAPH_REPORT.md` and `GRAPH_HEALTH.md`.
- Recoverable: deleting the entire graph loses nothing but time.
- **Contains no identity data.** Extraction denylist enforced and tested — no
  values from `auth.users` or `public.profiles`, no secrets, no credentials.

That last item is a hard boundary from `SECURITY_CONTEXT.md`, not a
nice-to-have.

## 7. Blockers

1. **No Graphify implementation exists in this environment.** Tasks A1–A8 cannot
   be executed here; they can only be specified, which is what this document
   does.
2. **No Gemini access** (see `GEMINI.md`), so the extraction step has no engine.
3. Whether Graphify is an existing third-party tool PRIME runs elsewhere or a
   component to be built here is **unresolved**, and it changes the work
   substantially. If it exists elsewhere, the next step is to bring the source or
   its output into this environment. If it is to be built, it needs a scoped
   implementation commit — which is currently frozen.

---

## For PRIME — what to take from this

**What was built:** a specification with testable acceptance criteria, not an
implementation.

**Why it exists:** so "production-ready" has a definition that can be checked
rather than asserted.

**Concepts involved:** _content-addressed storage_ (hashing source so staleness
is detectable rather than assumed); _atomic rename_ as the standard
crash-safe-write primitive; _incremental computation_ and the equivalence
property that keeps it honest; _provenance_.

**Industry practice:** every serious index — Bazel's action cache, ccache,
Language Server indexes, Sourcegraph — is built on content hashing plus atomic
swap. The pattern is well-trodden; the failures are always in the deletion path
and in trusting reused state.

**Common mistakes:** writing the graph in place (a crash leaves a corrupt file
that reads as valid); forgetting orphaned-edge cleanup; treating an incremental
result as correct without ever comparing it to a full rebuild; letting the
extractor version drift without invalidating what it produced.

**Further reading:** Mokhov, Mitchell & Peyton Jones, _Build Systems à la Carte_
(2018) — the clearest treatment of rebuild strategies and why hashing beats
timestamps.
