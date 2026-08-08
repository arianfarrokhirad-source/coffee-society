import type { AIProvider, AIRequest, AIResponse, ProviderProbeResult } from '../types'
import { AIProviderError } from '../types'

// OpenAI-compatible Chat Completions adapter. Works with api.openai.com
// and any OpenAI-compatible endpoint via OPENAI_BASE_URL.

interface OpenAIResponse {
  choices: { message?: { content?: string | null } }[]
  model: string
  usage?: { prompt_tokens: number; completion_tokens: number }
}

export function createOpenAIProvider(options?: {
  apiKey?: string
  baseUrl?: string
  fetchFn?: typeof fetch
}): AIProvider {
  const apiKey = () => options?.apiKey ?? process.env.OPENAI_API_KEY ?? ''
  const baseUrl = () => options?.baseUrl ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com'
  const fetchFn = options?.fetchFn ?? fetch

  return {
    name: 'openai',
    isConfigured: () => apiKey().length > 0,
    // Costs no tokens: lists models rather than generating any.
    async probe(signal: AbortSignal): Promise<ProviderProbeResult> {
      try {
        const response = await fetchFn(`${baseUrl()}/v1/models`, {
          method: 'GET',
          headers: { authorization: `Bearer ${apiKey()}` },
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
      if (!apiKey()) throw new AIProviderError('openai', 'OPENAI_API_KEY is not configured')

      const started = Date.now()
      const response = await fetchFn(`${baseUrl()}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey()}`,
        },
        body: JSON.stringify({
          model: request.model,
          max_tokens: request.maxTokens ?? 2048,
          ...(request.temperature != null ? { temperature: request.temperature } : {}),
          messages: request.messages,
        }),
      })

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new AIProviderError(
          'openai',
          `OpenAI API error ${response.status}: ${body.slice(0, 500)}`,
          response.status
        )
      }

      const data = (await response.json()) as OpenAIResponse
      const text = data.choices[0]?.message?.content ?? ''

      return {
        text,
        model: data.model,
        provider: 'openai',
        usage: data.usage
          ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens }
          : null,
        latencyMs: Date.now() - started,
      }
    },
  }
}
