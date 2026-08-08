# AI — JARVIS Phase 1 Audit

## Layer map

| File | Responsibility |
| --- | --- |
| `packages/ai/src/types.ts` | `AIProvider`, `AIRequest/Response`, `ModelRoute`, `AgentContext`, `ToolDefinition/Result`, `AIProviderError` |
| `packages/ai/src/providers/anthropic.ts` | Messages API adapter (direct fetch, no SDK) |
| `packages/ai/src/providers/openai.ts` | Chat Completions adapter (OpenAI-compatible; `OPENAI_BASE_URL` override) |
| `packages/ai/src/router.ts` | Route-kind → provider/model resolution + runtime fallback |
| `packages/ai/src/structured.ts` | JSON extraction + Zod validation + one feedback retry |
| `packages/workflows/src/classifier.ts` | Deterministic-first request classification |
| `packages/workflows/src/orchestrator.ts` | JVS-00 pipeline (see ARCHITECTURE.md) |
| `agents/` | Constitution + role cards + `composePrompt()` |

## Provider adapters

- Keys are read lazily (`process.env` at call time) so importing never
  crashes a keyless build; `isConfigured()` never throws.
- Non-2xx responses raise `AIProviderError` with status and a truncated body.
- Anthropic: system messages are lifted into the `system` field;
  `anthropic-version: 2023-06-01`; text blocks concatenated.
- OpenAI: standard chat body; usage mapped to a provider-neutral shape.
- Latency and token usage flow to `model_usage` via the orchestrator.

## Routing policy (env-only models — nothing hard-coded)

| Route kind | Primary | Env var |
| --- | --- | --- |
| `document` | Anthropic | `JARVIS_MODEL_DOCUMENT` |
| `review` | Anthropic | `JARVIS_MODEL_REVIEW` |
| `executive` | OpenAI | `JARVIS_MODEL_EXECUTIVE` |
| `extraction` | OpenAI | `JARVIS_MODEL_EXTRACTION` |

Resolution rules (router.ts):
- Primary usable = provider configured **and** its model env set.
- Otherwise fall back to the other provider using that provider's most
  general configured model (`executive`/`extraction` for OpenAI,
  `document`/`review` for Anthropic).
- Neither usable → structured error; the orchestrator degrades to a
  deterministic data summary and says so. It never fabricates model output.
- Runtime failure of the primary triggers one fallback attempt; both
  failing yields a combined error message.
- `availableProviders()` backs the Settings page status badges (booleans
  only — never key material).

## Structured output (structured.ts)

- A system instruction demands a single JSON object; temperature 0.
- `extractJson()` tolerates code fences and trailing prose, walks brackets
  string-aware (handles braces inside JSON strings).
- Parsed output is validated against the caller's Zod schema; failure
  produces **one** retry carrying the rejection reason; a second failure is
  a hard error. Free text is never used for orchestration decisions.
- Schemas (`packages/shared/src/schemas.ts`):
  - `executiveResponseSchema` — business/objective/status/findings/
    financialImpact/risks/actions/approvalRequired/priority/confidence/
    missingInformation, all length- and range-bounded
  - `taskClassificationSchema` — businessCode/intent/agentCode/priority/
    requiredData/requiredAuthority/externalAction/approvalRequired/
    reasoningSummary (max 1000 chars — concise rationale only; **no
    chain-of-thought is stored anywhere**)

## Classification (classifier.ts)

Deterministic rules run first and cover the documented command set
(approvals list, brief generation, task creation, performance review, risk
comparison, decision recording, external-action detection). External-action
keywords (`send/email/publish/post/pay/transfer/buy/…`) classify as
`external_action` with `approvalRequired: true` **before any model sees the
input** — a prompt-injected model cannot reroute those.

Free-form input goes to the `extraction` route; the model's classification
is clamped (`externalAction ⇒ approvalRequired`) and is advisory only — the
tool pipeline re-derives authority/approval independently. With no router,
classification falls back to a read-only `query`.

## Prompt composition (agents/)

`composePrompt()` layers: Master Constitution (v1, once) → role card →
business context → authorized retrieved data (only tool outputs the actor
was allowed to fetch) → task packet (the user's message). Role cards are
versioned files; agent capabilities live in the DB (`agents` table), so a
prompt can never widen permissions.

Constitution highlights the model is told (and the server enforces
regardless): no self-selected permissions, no external side effects,
approvals for restricted/costly actions, no invented data, financial
alternative signals are experimental only, no prompt/secret disclosure.

## What the model can and cannot cause

| Model output | Effect |
| --- | --- |
| Classification | Advisory routing; authority re-checked server-side |
| Executive response | Displayed + stored after Zod validation |
| Tool request (via intents) | Runs only through the tool pipeline's checks |
| Anything restricted | Becomes a pending approval for PRIME |
| Approval resolution | Impossible — PRIME-only, dual-enforced |

## Test coverage

`packages/ai/tests/` (16 tests): routing policy per kind, env-only models,
unconfigured/runtime fallback, both-fail error, JSON extraction edge cases,
retry-once semantics, schema-invalid rejection. `packages/workflows/tests/`
exercise the orchestrator with mock providers, including "model cannot
execute restricted actions by classification alone".
