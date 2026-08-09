# Multi-Model Engineering Policy

Issued by PRIME, 2026-08-04. Standing rule. Recorded here so it survives
session boundaries and ephemeral environments.

JARVIS is a distributed AI engineering platform. No single model performs every
task. The objective is to minimise context, tokens, cost and duplicated work
while maximising reliability and engineering quality.

## Model responsibilities

| Model             | Role              | Owns                                                                                                                                                            |
| ----------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Claude**        | Chief Architect   | Architecture, system design, security, complex reasoning, planning, agent orchestration, code review, technical decisions, hard debugging, mentoring PRIME      |
| **Gemini**        | Processing Engine | Graphify semantic extraction, embeddings, OCR, large-document analysis, knowledge extraction, repository indexing, bulk transformations, high-volume processing |
| **ChatGPT Codex** | Software Engineer | Feature implementation, boilerplate, refactoring, unit and integration tests, documentation generation, routine bug fixes, repetitive coding                    |

Claude is **not** to be used for large-scale indexing, bulk extraction,
repetitive implementation, or long-document processing when another model fits
better. Gemini is the preferred provider whenever Graphify performs semantic
extraction.

Claude defines architecture → Codex implements it → Claude reviews what matters.

## Context policy

Prefer retrieval over memory. Load the minimum required for the task at hand.
Retrieval priority:

1. Graphify
2. Obsidian
3. Supabase
4. Google Drive
5. Repository files

Never re-read the repository when Graphify already holds the knowledge.

## Delegation policy

Before Claude implements anything, ask: Can Codex implement this? Can Gemini
process it? Does Graphify already know it? Does Obsidian already contain it? Is
Claude actually required? If the answer is no, delegate rather than doing the
work directly.

## Token efficiency

Minimise context window, repository scans, duplicate reads, duplicate planning,
repeated documentation and repeated explanation. Reuse existing abstractions,
documentation, the Graphify graph and Obsidian knowledge. Never regenerate
completed work.

## Workflow

```
Architecture      → Claude
Implementation    → Codex
Bulk processing   → Gemini
Verification      → Claude
Knowledge update  → Obsidian
Graph update      → Graphify
Operational state → Supabase
```

## Learning mode

Every completed feature must teach PRIME: what was built, why it exists, the
programming concepts involved, industry best practice, common mistakes, and
recommended further reading. Building JARVIS and developing PRIME into a senior
engineer are one objective, not two.

## Approval policy

PRIME approves architecture, database changes, infrastructure, security,
migrations, agent hierarchy, external integrations, major refactors, and any
irreversible change. Never proceed on these without explicit approval.

---

## Current enforceability (state of the world, 2026-08-04)

This policy is recorded in full above. Two parts of it cannot be executed from
this environment today, and saying otherwise would be false:

- **Gemini and Codex are not reachable from this session.** No Gemini or Codex
  tool, credential or route exists here. Delegation to them is currently a
  manual step PRIME performs outside this session. Standing up a routing seam is
  unbuilt work requiring PRIME approval.
- **Graphify and Obsidian do not exist in this repository.** The `/graphify`
  command returns `Unknown command`; there is no `graphify-out` directory and no
  vault. Until they exist, the retrieval priority order collapses to Supabase →
  repository files, and repository reads are not avoidable duplication — they
  are the only source.

The **memory-architecture rule remains in force and is unchanged by this policy**
(see `SECURITY_CONTEXT.md`): graph memory is JARVIS operational and temporal
memory, the Obsidian vault is the Farrokhirad reviewed human knowledge base, and
Supabase is authoritative transactional and identity state. Graphiti, Graphify
and Obsidian stay unimplemented until the conversation-memory phase after
current hardening. No password, authentication token, phone number, birth date,
sex or other identity data may ever be written to graph memory or Obsidian.

Where this policy and the standing hardening freeze disagree, the freeze wins
until PRIME lifts it.
