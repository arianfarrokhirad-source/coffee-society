# Model Routing

Status: **documentation only**, per PRIME's Phase E instruction. No feature
implementation. Where this document describes behaviour that does not exist, it
says so explicitly.

Companion to `codebase/context/ENGINEERING_POLICY.md` (the policy) and
`MEMORY_ARCHITECTURE.md` (where context comes from). This document is the
*routing table*: which model does which work, and why.

---

## 1. Responsibilities

| Model | Role | Routes to it | Never route to it |
| --- | --- | --- | --- |
| **Claude** | Chief Architect | Architecture, system design, security review, complex reasoning, planning, agent orchestration, code review, hard debugging, teaching PRIME | Bulk indexing, mass extraction, repetitive implementation, long-document grinding |
| **Gemini** | Processing Engine | Graphify semantic extraction, embeddings, OCR, large-document analysis, knowledge extraction, repository indexing, bulk transforms | Architecture decisions, security judgements, final review |
| **Codex** | Software Engineer | Feature implementation, boilerplate, refactoring, unit and integration tests, doc generation, routine bug fixes | Deciding *what* to build; approving its own work |

The workflow, stated once: **Claude designs → Codex implements → Claude
verifies.** Gemini runs alongside as the bulk processor and never enters that
decision loop.

## 2. Routing rules

### By task shape

| Task shape | Model | Rationale |
| --- | --- | --- |
| "Should we do X, and how?" | Claude | Judgement under ambiguity |
| "Is this safe / correct?" | Claude | Verification must be independent of implementation |
| "Build this, here's the spec" | Codex | Mechanical translation of a settled design |
| "Extract structure from N files" | Gemini | Throughput and context length dominate |
| "Summarise this 200-page document" | Gemini | Long-context work is its comparative advantage |
| "Turn this into embeddings" | Gemini | Bulk, deterministic, cost-sensitive |

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
**not** this routing table. It routes *runtime application traffic*, not
engineering work. Stating its actual shape so the two are never confused:

| Route kind | Primary provider | Model source |
| --- | --- | --- |
| `executive` | OpenAI | `JARVIS_MODEL_EXECUTIVE` |
| `document` | Anthropic | `JARVIS_MODEL_DOCUMENT` |
| `extraction` | OpenAI | `JARVIS_MODEL_EXTRACTION` |
| `review` | Anthropic | `JARVIS_MODEL_REVIEW` |

Properties worth knowing, verified by reading the source:

- Provider selection is a static table, `ROUTE_PROVIDER`; model names come
  exclusively from environment variables, nothing hard-coded.
- Cross-provider fallback exists: if the primary is unconfigured or throws, the
  other provider answers with its closest configured model, and the response
  reports which provider actually answered.
- `isConfigured()` never throws, so a missing key degrades routing rather than
  crashing the request.
- Registered providers: **Anthropic and OpenAI only.** There is no Gemini
  adapter.

### The exact gap between this document and the code

To add Gemini as a runtime provider, three changes are required — **none of which
are made here**, since Phase E is documentation only:

1. `AIProviderName` in `@jarvis/shared` must gain `'gemini'`.
2. `packages/ai/src/providers/gemini.ts` must implement the `AIProvider`
   interface (`name`, `isConfigured()`, `complete()`), matching the existing
   adapters' direct-HTTPS style — no SDK dependency.
3. `ROUTE_PROVIDER` and `fallbackModelFor` must be extended, and the two-provider
   fallback assumption (`primary === 'openai' ? 'anthropic' : 'openai'`) replaced,
   because it is hard-coded to exactly two providers today.

Item 3 is the non-obvious one: the current fallback logic is not merely
"unaware" of a third provider, it is structurally binary. Adding Gemini without
addressing it produces silently wrong fallbacks.

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

**Concepts involved:** the *strategy pattern* (`AIProvider` is an interface with
swappable implementations, which is why adding Gemini is additive rather than
invasive); *graceful degradation* (`isConfigured()` never throws); *escalation
paths* in delegated systems.

**Industry practice:** provider abstraction behind a stable interface, model
names in configuration rather than code, and an explicit fallback policy. The
existing router does all three correctly — worth studying as a reference for
the Gemini adapter.

**Common mistakes:** hard-coding model names (avoided here); assuming exactly two
providers (present here, §3 item 3 — a real latent bug for any third provider);
routing by cost alone until a decision gets made by the cheapest model in the
chain.

**Further reading:** Gamma et al., *Design Patterns*, Strategy; Nygard,
*Release It!*, on fallback and degradation.
