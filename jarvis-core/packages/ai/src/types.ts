import type { AgentCode, AIProviderName, AuthorityLevel, BusinessCode } from '@jarvis/shared'

// ---------------------------------------------------------------------
// Provider-independent AI interfaces (section 15). No provider-specific
// logic leaks past the adapters in ./providers.
// ---------------------------------------------------------------------

export interface AIMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AIRequest {
  messages: AIMessage[]
  model: string
  maxTokens?: number
  temperature?: number
}

export interface AIUsage {
  inputTokens: number
  outputTokens: number
}

export interface AIResponse {
  text: string
  model: string
  provider: AIProviderName
  usage: AIUsage | null
  latencyMs: number
}

export interface AIProvider {
  readonly name: AIProviderName
  /** True when credentials exist. Never throws. */
  isConfigured(): boolean
  complete(request: AIRequest): Promise<AIResponse>
  /**
   * Cheap liveness probe against the provider, used by
   * checkProviderHealth(). Optional so a provider (or a test double) is
   * still valid without one — absence reports `unknown`, never a
   * fabricated `healthy`.
   *
   * Implementations must hit an endpoint that costs no tokens, must
   * honour `signal`, and must never include response bodies in the
   * result: some providers echo request headers on error.
   */
  probe?(signal: AbortSignal): Promise<ProviderProbeResult>
  /**
   * Turns text into vectors. Optional because not every provider offers
   * embeddings — Anthropic does not, and pretending otherwise would put a
   * method on the interface that always throws.
   *
   * Absence is meaningful and is what resolveEmbeddingRoute() reads: a
   * provider without embed() is simply not a candidate.
   */
  embed?(request: EmbeddingRequest): Promise<EmbeddingResponse>
  /**
   * Largest number of inputs the provider accepts in one embed() call.
   * Callers must respect it; exceeding it is a 400, not a slow success.
   * Undefined means "unspecified" and callers should send one at a time.
   */
  readonly maxEmbeddingBatch?: number
}

/**
 * What the vector will be used for.
 *
 * This is not decoration. Modern embedding models are ASYMMETRIC: they
 * project a stored passage and the question asked about it into
 * deliberately different places, because a question rarely looks like its
 * own answer. "How do I reset a password?" shares few words with the
 * paragraph that explains it.
 *
 * Embedding both sides with the same task type is the single most common
 * way to build retrieval that returns plausible nonsense — it still
 * returns the nearest neighbours, they are just the wrong ones, so the
 * bug reads as "the model is not very good" rather than as a defect.
 *
 * Corollary that governs this whole package: a stored vector is only
 * comparable to another vector produced by the SAME model AND the same
 * side of that asymmetry. That is why EmbeddedVector carries its model
 * and task type around with it.
 */
export type EmbeddingTaskType =
  'document' | 'query' | 'similarity' | 'classification' | 'clustering' | 'code_query'

export interface EmbeddingRequest {
  model: string
  inputs: string[]
  taskType?: EmbeddingTaskType
  /**
   * Requested vector width, for models that support truncation. Omitted
   * means the model's native width.
   */
  dimensions?: number
}

export interface EmbeddingVector {
  /** Position in the request's `inputs`. Order is a contract. */
  index: number
  values: number[]
}

export interface EmbeddingResponse {
  provider: AIProviderName
  model: string
  vectors: EmbeddingVector[]
  /** Embedding endpoints bill input only; there is no output to charge for. */
  usage: AIUsage | null
  latencyMs: number
  /** Width of the returned vectors, or null when none came back. */
  dimensions: number | null
}

/** Raw outcome of one liveness probe, before classification. */
export interface ProviderProbeResult {
  /** HTTP status observed, or null when the request never completed. */
  httpStatus: number | null
  /** Set only when no response was received (DNS, TLS, timeout, reset). */
  transportError?: string
}

/**
 * Three questions, deliberately separate, because operators conflate
 * them and then misdiagnose outages:
 *
 *   configured — is a credential present? (no network involved)
 *   reachable  — did we get any HTTP response at all?
 *   healthy    — did the provider accept the credential and answer?
 *
 * A provider can be configured but unreachable (network), reachable but
 * unauthorized (bad key), or reachable and authorized but rate limited.
 * Only `healthy` predicts that a real request will succeed.
 */
export type ProviderHealthStatus =
  | 'unconfigured'
  | 'unreachable'
  | 'unauthorized'
  | 'rate_limited'
  | 'degraded'
  | 'healthy'
  | 'unknown'

export interface ProviderHealth {
  provider: AIProviderName
  status: ProviderHealthStatus
  configured: boolean
  reachable: boolean
  healthy: boolean
  /** HTTP status from the probe, or null when nothing was received. */
  httpStatus: number | null
  /** Probe duration. 0 when no probe ran. */
  latencyMs: number
  checkedAt: string
  /**
   * Short, fixed reason token — never a provider response body and
   * never anything derived from a credential.
   */
  reason: string
}

/** What kind of work a request is — drives provider/model selection. */
export type RouteKind = 'executive' | 'document' | 'extraction' | 'review'

export interface ModelRoute {
  kind: RouteKind
  provider: AIProviderName
  model: string
  /**
   * Which provider+model to try if the primary is unavailable.
   * Retained for callers that only need the next hop; `chain` is the
   * complete picture.
   */
  fallback: { provider: AIProviderName; model: string } | null
  /**
   * Every usable provider+model for this route, in preference order,
   * starting with the primary. The router walks this on failure, so a
   * route is only unroutable when every entry has been tried.
   */
  chain: { provider: AIProviderName; model: string }[]
}

/** Context assembled by the orchestrator for a specialist agent call. */
export interface AgentContext {
  agentCode: AgentCode
  businessCode: BusinessCode | null
  authorityLevel: AuthorityLevel
  systemPrompt: string
  authorizedData: string[]
  taskPacket: string
}

export interface ToolDefinition {
  name: string
  description: string
  /** JSON-schema-ish description shown to the model. Validation happens server-side with Zod. */
  parameters: Record<string, unknown>
}

export interface ToolResult {
  toolName: string
  status: 'executed' | 'denied' | 'failed'
  result?: unknown
  denialReason?: string
  error?: string
}

export class AIProviderError extends Error {
  provider: AIProviderName
  status: number | null
  /**
   * Milliseconds the provider asked us to wait, parsed from Retry-After.
   * Null when the provider did not say. The retry layer prefers this over
   * its own backoff: the provider knows its quota window and we do not.
   */
  retryAfterMs: number | null
  constructor(
    provider: AIProviderName,
    message: string,
    status: number | null = null,
    retryAfterMs: number | null = null
  ) {
    super(message)
    this.name = 'AIProviderError'
    this.provider = provider
    this.status = status
    this.retryAfterMs = retryAfterMs
  }
}
