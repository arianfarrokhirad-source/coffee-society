# AI routing

## Interfaces

`@jarvis/ai` defines `AIProvider`, `AIRequest`, `AIResponse`, `ModelRoute`,
`AgentContext`, `ToolDefinition`, `ToolResult`. Provider specifics live only
inside the two adapters (`providers/anthropic.ts`, `providers/openai.ts` —
direct HTTPS, no SDK dependency, keys read lazily server-side).

## Routing policy

| Route kind                                          | Primary provider | Model env var             |
| --------------------------------------------------- | ---------------- | ------------------------- |
| `document` (long document review)                   | Anthropic        | `JARVIS_MODEL_DOCUMENT`   |
| `review` (SOP/policy analysis, second-model review) | Anthropic        | `JARVIS_MODEL_REVIEW`     |
| `executive` (executive/operational reasoning)       | OpenAI           | `JARVIS_MODEL_EXECUTIVE`  |
| `extraction` (structured extraction, economical)    | OpenAI           | `JARVIS_MODEL_EXTRACTION` |

- **No model name is hard-coded.** Unset env var ⇒ that route is unavailable.
- **Fallback:** if the primary provider is unconfigured or fails at runtime,
  the router retries on the other provider with its closest configured model
  and reports which provider actually answered. If neither is available the
  router returns a structured error and JARVIS degrades to deterministic
  data summaries — it never fakes a model answer.
- Every model call is recorded in `model_usage` (provider, model, tokens,
  latency, success).

## Structured output

`completeStructured()` instructs JSON-only output, extracts the JSON (fence-
and prose-tolerant), parses, validates against the given Zod schema
(`executiveResponseSchema`, `taskClassificationSchema`), and retries once
with validation feedback. Invalid output after retry is a hard error.
Only concise `reasoningSummary` strings are ever stored — no chain-of-thought.

## Classification

`classifyDeterministic()` handles the documented command set with rules —
free, offline, fully tested. Everything else goes through the `extraction`
route. The model's classification is advisory: external actions are forced to
`approvalRequired`, and actual authority checks happen independently in the
tool pipeline (`@jarvis/workflows/src/tools.ts`).

## Second-model review

`review` routes to Anthropic and exists for high-impact recommendations; the
orchestrator currently uses `executive` for chat and leaves `review` available
to future workflows (e.g. ORACLE research review) without new plumbing.
