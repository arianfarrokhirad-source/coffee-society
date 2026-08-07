# Gemini — Processing Engine

Status: **not integrated**. This document is a required-contract specification
and a verification checklist, not a verification result.

---

## 1. Verification attempted, 2026-08-07

PRIME asked for seven items to be verified. Each was checked against the actual
JARVIS build environment. Results:

| # | Item | Result |
| --- | --- | --- |
| 1 | `GEMINI_API_KEY` present | **Absent.** The only AI-related variable in the environment is `ANTHROPIC_BASE_URL`. No Gemini, Google, or Vertex credential of any kind |
| 2 | Graphify uses Gemini | **Cannot verify — neither exists.** No Graphify implementation (see `GRAPHIFY.md`), so there is no caller to inspect |
| 3 | Rate limiting handled | **Not implemented.** No rate-limit handling exists for any provider; `packages/security/src/rate-limit.ts` is an in-memory limiter for *application* actions, unrelated to provider quotas |
| 4 | Retry strategy | **Not implemented for Gemini.** The AI router has cross-*provider* fallback but no per-request retry or backoff |
| 5 | Provider abstraction | **Exists, and is sound** — `AIProvider` in `packages/ai/src/types.ts`. Gemini is simply not one of its implementations |
| 6 | Cost logging | **Not implemented.** `AIResponse.usage` carries `inputTokens`/`outputTokens` but nothing aggregates or prices it |
| 7 | Health check | **Not implemented.** `isConfigured()` reports credential presence only — it never contacts the provider |

Registered providers today: **Anthropic and OpenAI.** That is the complete list.

## 2. What must be true before Gemini is usable

### Credential

`GEMINI_API_KEY` set in the environment (Vercel project settings for deployed
code, shell environment for tooling). Server-side only — never `NEXT_PUBLIC_`,
never in a client bundle, never committed.

### Adapter

`packages/ai/src/providers/gemini.ts`, implementing `AIProvider`:

```ts
interface AIProvider {
  readonly name: AIProviderName   // requires 'gemini' added to the union
  isConfigured(): boolean         // credential presence only; never throws
  complete(request: AIRequest): Promise<AIResponse>
}
```

Match the house style of the existing adapters: **direct HTTPS, no SDK
dependency**. Throw `AIProviderError` with the provider name and HTTP status on
failure — the router's fallback path depends on that shape.

### Router changes

Three edits, detailed in `MODEL_ROUTING.md` §3. The non-obvious one: the current
fallback is structurally binary (`primary === 'openai' ? 'anthropic' : 'openai'`).
A third provider requires replacing that expression, not merely extending the
table — otherwise fallbacks are silently wrong.

## 3. Required operational behaviour

### Rate limiting

Gemini enforces per-minute request and token quotas that differ by tier and
model. Requirements:

- Client-side limiter that refuses to exceed the configured budget, so quota
  errors are rare rather than routine.
- Configurable per-model, since limits differ.
- Bulk extraction (Graphify's use case) must run under a concurrency cap; the
  natural failure of an indexer is to open a request per file and immediately
  exhaust quota.

### Retry strategy

- Retry on 429 and 5xx. **Never** retry 400/401/403 — those are deterministic and
  retrying converts a clear error into a slow one.
- Exponential backoff with jitter. Jitter is not optional: without it, N workers
  that fail together retry together and re-collide, indefinitely.
- Honour `Retry-After` when present.
- Bounded attempts, then fail loudly with the status preserved.

### Cost logging

Per call, record: model, route kind, input tokens, output tokens, latency,
success/failure, and caller. Aggregate per run. `AIResponse.usage` already
carries the token counts — this is the seam.

Cost data must **never** include prompt or completion text; a token count is
telemetry, a prompt is potentially identity data or business content.

### Health check

Distinct from `isConfigured()`. A health check makes a minimal live call and
reports reachable / unauthorized / rate-limited / unreachable. Needed because
"key is present" and "key works" are different facts, and only the second one
predicts whether a build will succeed.

## 4. Blockers

1. **No `GEMINI_API_KEY` in this environment.** Everything in §3 is unverifiable
   until a credential exists. PRIME must provision it — I must not request,
   display, or handle the value.
2. **No Graphify** to consume it (`GRAPHIFY.md`).
3. **Adapter is a code change**, currently under the application-feature freeze.
   §2 specifies it precisely so it can be implemented the moment the freeze lifts
   — or delegated to Codex, which is exactly the kind of well-specified
   mechanical work the engineering policy routes there.

---

## For PRIME — what to take from this

**What was built:** an honest verification result (seven items, one of which
passes) plus the contract Gemini integration must satisfy.

**Why it exists:** so that "verify Gemini" has a checkable answer rather than an
assumed one. Six of seven items were not "unknown" — they were verifiably absent.

**Concepts involved:** *adapter pattern* (why adding a provider is additive);
*exponential backoff with jitter* (§3 — the jitter is the part people omit and
the part that matters under concurrency); *liveness vs configuration checks*;
*idempotent retry classification* — knowing which errors are worth retrying.

**Industry practice:** never retry 4xx except 429; always jitter; always cap
attempts; keep provider SDKs out of the core when the HTTP surface is small —
which is the choice the existing adapters already made.

**Common mistakes:** retrying authentication failures; unjittered backoff
causing thundering herds; logging prompts alongside token counts and turning
telemetry into a data-protection problem; treating "key present" as "provider
healthy".

**Further reading:** AWS Architecture Blog, *Exponential Backoff and Jitter*;
Google Cloud generative-AI quota documentation for the current per-model limits.
