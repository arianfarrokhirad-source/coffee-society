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
