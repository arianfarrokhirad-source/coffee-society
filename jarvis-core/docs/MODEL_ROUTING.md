# Model Routing

Status: **partially implemented.** Gemini is a registered provider and the
router is provider-agnostic as of the AI Independence work. Where this document
describes behaviour that does not exist, it says so explicitly.

Companion to `codebase/context/ENGINEERING_POLICY.md` (the policy) and
`MEMORY_ARCHITECTURE.md` (where context comes from). This document is the
_routing table_: which model does which work, and why.

---

## 1. Responsibilities

| Model      | Role              | Routes to it                                                                                                                                | Never route to it                                                                 |
| ---------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Claude** | Chief Architect   | Architecture, system design, security review, complex reasoning, planning, agent orchestration, code review, hard debugging, teaching PRIME | Bulk indexing, mass extraction, repetitive implementation, long-document grinding |
| **Gemini** | Processing Engine | Graphify semantic extraction, embeddings, OCR, large-document analysis, knowledge extraction, repository indexing, bulk transforms          | Architecture decisions, security judgements, final review                         |
| **Codex**  | Software Engineer | Feature implementation, boilerplate, refactoring, unit and integration tests, doc generation, routine bug fixes                             | Deciding _what_ to build; approving its own work                                  |

The workflow, stated once: **Claude designs → Codex implements → Claude
verifies.** Gemini runs alongside as the bulk processor and never enters that
decision loop.

## 2. Routing rules

### By task shape

| Task shape                         | Model  | Rationale                                          |
| ---------------------------------- | ------ | -------------------------------------------------- |
| "Should we do X, and how?"         | Claude | Judgement under ambiguity                          |
| "Is this safe / correct?"          | Claude | Verification must be independent of implementation |
| "Build this, here's the spec"      | Codex  | Mechanical translation of a settled design         |
| "Extract structure from N files"   | Gemini | Throughput and context length dominate             |
| "Summarise this 200-page document" | Gemini | Long-context work is its comparative advantage     |
| "Turn this into embeddings"        | Gemini | Bulk, deterministic, cost-sensitive                |

### The delegation test

Before Claude implements anything, in order:

1. Can **Codex** implement this from a written spec? → write the spec, delegate.
2. Can **Gemini** process this in bulk? → delegate.
3. Does **Graphify** already know it? → retrieve, don't re-derive.
4. Does **Obsidian** already contain it? → retrieve, don't re-explain.
5. Is **Claude** actually required? → if no to all above, delegate.

If the honest answer to (5) is "yes, this needs judgement", Claude does it. The
test is a filter, not a prohibition — misrouting an architecture decision to save
tokens costs more than it saves.

### Escalation

Route **up** to Claude when: a task the Router classified as mechanical turns out
to require a decision; a security or authorization boundary is touched; two
sources disagree; or an implementation would change a documented contract.

Route **down** from Claude when: the remaining work is transcription of a settled
design.

## 3. What exists today

The repository has a model router — `packages/ai/src/router.ts` — but it is
**not** this routing table. It routes _runtime application traffic_, not
engineering work. Stating its actual shape so the two are never confused:

| Route kind   | Provider preference order       | Model source                                                                                    |
| ------------ | ------------------------------- | ----------------------------------------------------------------------------------------------- |
| `executive`  | OpenAI → Anthropic → Gemini     | `JARVIS_MODEL_<PROVIDER>_EXECUTIVE`, `JARVIS_MODEL_<PROVIDER>`, legacy `JARVIS_MODEL_EXECUTIVE` |
| `document`   | Anthropic → Gemini → OpenAI     | as above, `_DOCUMENT`                                                                           |
| `extraction` | **Gemini** → OpenAI → Anthropic | as above, `_EXTRACTION`                                                                         |
| `review`     | Anthropic → OpenAI → Gemini     | as above, `_REVIEW`                                                                             |

Properties, verified against the source:

- **Registered providers: Anthropic, OpenAI, Gemini.** Adding a fourth means
  implementing `AIProvider` and naming it in `ROUTE_PREFERENCE` — no structural
  change.
- Provider selection walks an ordered chain. `ModelRoute.chain` exposes every
  usable provider+model in preference order; `complete()` walks it, so a route
  fails only when every candidate has been tried.
- Model names come exclusively from the environment. Nothing is hard-coded and
  no provider is hard-coded as the default.
- A model name is never lent across vendors. `LEGACY_ROUTE_ANCHOR` records which
  provider owns each route-scoped `JARVIS_MODEL_<KIND>` variable; a provider with
  no model of its own is skipped rather than handed another vendor's model string.
- `isConfigured()` never throws, so a missing key degrades routing rather than
  crashing the request.
- No business logic references a provider by name: `AIProviderName` is the only
  provider type in `store.ts`, `orchestrator.ts` and `ChatUI.tsx`.

### Still missing

Health checks, retry with backoff, and cost tracking are **not** implemented for
any provider. The `AIUsage` field carries token counts that nothing aggregates.
See `GEMINI.md` §3 for the required behaviour.

## 4. Engineering-work routing is manual today

Neither Gemini nor Codex is reachable from the JARVIS build environment: no
credentials, no tool, no route. Delegation described in §2 is therefore a manual
step PRIME performs — copying a spec into another tool — not an automated
dispatch.

Automating it means building the Router component described in
`MEMORY_ARCHITECTURE.md` §5, which is unbuilt work requiring PRIME approval.

## 5. Cost and context discipline

Applies regardless of which model answers:

- Load the minimum context required. Retrieval beats memory; precedence order in
  `MEMORY_ARCHITECTURE.md` §4.
- Never regenerate completed work — reuse existing abstractions, docs, graph and
  vault.
- Prefer one well-scoped call over several exploratory ones.
- Log token usage per route. The `AIUsage` field already exists on `AIResponse`
  (`inputTokens` / `outputTokens`) and is currently unused for cost tracking —
  that is the natural seam for it.

---

## For PRIME — what to take from this

**What was built:** a routing table separating engineering-work routing (this
document) from runtime application routing (`packages/ai/src/router.ts`).

**Why it exists:** using one model for everything is both expensive and worse —
bulk extraction and architectural judgement reward different capabilities.

**Concepts involved:** the _strategy pattern_ (`AIProvider` is an interface with
swappable implementations, which is why adding Gemini is additive rather than
invasive); _graceful degradation_ (`isConfigured()` never throws); _escalation
paths_ in delegated systems.

**Industry practice:** provider abstraction behind a stable interface, model
names in configuration rather than code, and an explicit fallback policy. The
existing router does all three correctly — worth studying as a reference for
the Gemini adapter.

**Common mistakes:** hard-coding model names (avoided here); assuming exactly two
providers (present here, §3 item 3 — a real latent bug for any third provider);
routing by cost alone until a decision gets made by the cheapest model in the
chain.

**Further reading:** Gamma et al., _Design Patterns_, Strategy; Nygard,
_Release It!_, on fallback and degradation.
