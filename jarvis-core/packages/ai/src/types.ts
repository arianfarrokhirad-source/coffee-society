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
  constructor(provider: AIProviderName, message: string, status: number | null = null) {
    super(message)
    this.name = 'AIProviderError'
    this.provider = provider
    this.status = status
  }
}
