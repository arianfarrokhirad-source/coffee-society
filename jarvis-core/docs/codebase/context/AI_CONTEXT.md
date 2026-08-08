<!--
Type: manual
Canonical for: nothing — packages/ai + packages/workflows are canonical
Update when: capabilities, routing policy or the implemented/planned split changes
Owner: PRIME
Budget: Tiny (~150 lines)
-->

# AI runtime context

Load for: model routing, prompts, classification, structured output, agent
behaviour, conversation handling.

## Capability registry (capabilities, not vendors)

Providers are interchangeable implementations of a capability. Nothing
downstream should name a vendor.

| Capability                         | Route kind   | Model env var             | Current primary | Fallback                       |
| ---------------------------------- | ------------ | ------------------------- | --------------- | ------------------------------ |
| Long-context analysis              | `document`   | `JARVIS_MODEL_DOCUMENT`   | Anthropic       | other provider's general model |
| Policy / second-opinion review     | `review`     | `JARVIS_MODEL_REVIEW`     | Anthropic       | "                              |
| Executive reasoning                | `executive`  | `JARVIS_MODEL_EXECUTIVE`  | OpenAI          | "                              |
| Structured extraction (economical) | `extraction` | `JARVIS_MODEL_EXTRACTION` | OpenAI          | "                              |

**No model name is hard-coded.** Unset env var ⇒ capability unavailable.
Neither provider available ⇒ structured error and a deterministic data
summary that says so. The system never fabricates a model answer.

## Implementation status — read this before believing any other document

| Capability                                                             | Status                                                                                                                                                                           |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider adapters (Anthropic, OpenAI), direct fetch, lazy keys         | **implemented**                                                                                                                                                                  |
| Capability routing + cross-provider fallback                           | **implemented**                                                                                                                                                                  |
| Zod-validated structured output, one feedback retry                    | **implemented**                                                                                                                                                                  |
| Deterministic-first classification (5 documented commands, zero keys)  | **implemented**                                                                                                                                                                  |
| Composable prompts (constitution + role card + business + data + task) | **implemented**                                                                                                                                                                  |
| Run/tool/model-usage logging                                           | **implemented**                                                                                                                                                                  |
| Approval gating of restricted actions                                  | **implemented**                                                                                                                                                                  |
| **Model-driven tool calling**                                          | **NOT implemented** — `ToolDefinition` is exported and unused; tools run from hardcoded intent branches. The enforcement pipeline is real; the model-requests-tools part is not. |
| **Conversation memory**                                                | **NOT implemented** — `agent_messages` table exists and is never written; every message is stateless (commit 11)                                                                 |
| Fallback/degradation recorded in `model_usage`                         | **partial** — provider/model/tokens recorded; route kind, fallback flag and reason are not (commit 12)                                                                           |
| Cost budgets                                                           | **NOT implemented** (commit 12)                                                                                                                                                  |
| Streaming                                                              | **NOT implemented**                                                                                                                                                              |
| Second-model review workflow                                           | route exists, **no workflow uses it**                                                                                                                                            |

## Modules

| Path                                              | Role                                                          |
| ------------------------------------------------- | ------------------------------------------------------------- |
| `packages/ai/src/router.ts`                       | capability → provider/model, fallback, `availableProviders()` |
| `packages/ai/src/structured.ts`                   | JSON extraction (fence/prose/brace-aware) + Zod + one retry   |
| `packages/ai/src/providers/{anthropic,openai}.ts` | the only vendor-specific code                                 |
| `packages/workflows/src/classifier.ts`            | rules first; model refinement clamped                         |
| `packages/workflows/src/orchestrator.ts`          | 12-step run                                                   |
| `agents/src/index.ts`                             | `composePrompt()` — constitution appears **once**             |
| `agents/*/role-card.ts`                           | versioned per-agent prompts                                   |

## Rules

1. **The model never holds permissions.** Classification is advisory; the tool
   pipeline re-derives authority. External-action keywords force the approval
   path _before_ any model sees the input.
2. **Never trust free text for orchestration** — parse and validate, or fail.
3. **Never store chain-of-thought.** `reasoningSummary` is capped at 1000 chars
   and is a decision rationale, not deliberation.
4. **Never hard-code a model name** — env vars only.
5. **Deterministic commands must survive** with no keys configured.
6. Prompt context should be structured data, not UI-formatted strings —
   currently violated (glyph-formatted tool output is fed back as "authorized
   data"); fixed in commit 9.

## Tests

```bash
npx vitest run packages/ai packages/workflows
```

Mocked providers only — **no test calls a real provider API**, and no
adapter has been integration-verified against a live endpoint.
