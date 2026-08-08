import type { AIProvider, AIRequest, AIResponse, ProviderProbeResult } from '../types'
import { AIProviderError } from '../types'

// Anthropic Messages API adapter. Direct HTTPS, no SDK dependency.
// The API key lives server-side only and is read lazily so importing
// this module never crashes a build without credentials.

interface AnthropicContentBlock {
  type: string
  text?: string
}

interface AnthropicResponse {
  content: AnthropicContentBlock[]
  model: string
  usage?: { input_tokens: number; output_tokens: number }
}

/**
 * Retry-After is either delta-seconds or an HTTP date. Both appear in
 * the wild; a parser that handles only one silently ignores the other.
 */
function parseRetryAfter(header: string | null): number | null {
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000)
  const when = Date.parse(header)
  if (Number.isNaN(when)) return null
  return Math.max(0, when - Date.now())
}

export function createAnthropicProvider(options?: {
  apiKey?: string
  baseUrl?: string
  fetchFn?: typeof fetch
}): AIProvider {
  const apiKey = () => options?.apiKey ?? process.env.ANTHROPIC_API_KEY ?? ''
  const baseUrl = options?.baseUrl ?? 'https://api.anthropic.com'
  const fetchFn = options?.fetchFn ?? fetch

  return {
    name: 'anthropic',
    isConfigured: () => apiKey().length > 0,
    // Costs no tokens: lists models rather than generating any.
    async probe(signal: AbortSignal): Promise<ProviderProbeResult> {
      try {
        const response = await fetchFn(`${baseUrl}/v1/models?limit=1`, {
          method: 'GET',
          headers: { 'x-api-key': apiKey(), 'anthropic-version': '2023-06-01' },
          signal,
        })
        return { httpStatus: response.status }
      } catch (cause) {
        return {
          httpStatus: null,
          transportError: cause instanceof Error ? cause.name : 'unknown',
        }
      }
    },
    async complete(request: AIRequest): Promise<AIResponse> {
      if (!apiKey()) throw new AIProviderError('anthropic', 'ANTHROPIC_API_KEY is not configured')

      const system = request.messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n\n')
      const messages = request.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role, content: m.content }))

      const started = Date.now()
      const response = await fetchFn(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey(),
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: request.model,
          max_tokens: request.maxTokens ?? 2048,
          ...(request.temperature != null ? { temperature: request.temperature } : {}),
          ...(system ? { system } : {}),
          messages,
        }),
      })

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new AIProviderError(
          'anthropic',
          `Anthropic API error ${response.status}: ${body.slice(0, 500)}`,
          response.status,
          parseRetryAfter(response.headers.get('retry-after'))
        )
      }

      const data = (await response.json()) as AnthropicResponse
      const text = data.content
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('')

      return {
        text,
        model: data.model,
        provider: 'anthropic',
        usage: data.usage
          ? { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens }
          : null,
        latencyMs: Date.now() - started,
      }
    },
  }
}
