import type { AIProvider, AIRequest, AIResponse } from '../types'
import { AIProviderError } from '../types'

// Google Gemini adapter (Generative Language API). Direct HTTPS, no SDK
// dependency — same house style as the Anthropic and OpenAI adapters, so
// the dependency surface does not grow with each provider.
//
// The key is read lazily through a closure so importing this module can
// never crash a build that has no credentials, and isConfigured() stays
// a pure credential-presence check that never throws.
//
// Two shape differences from the other providers are handled here and
// nowhere else, which is the entire point of the adapter boundary:
//   * Gemini calls the assistant role "model";
//   * the system prompt is a separate `systemInstruction` field rather
//     than a message with role "system".

interface GeminiPart {
  text?: string
}

interface GeminiCandidate {
  content?: { parts?: GeminiPart[] }
}

interface GeminiResponse {
  candidates?: GeminiCandidate[]
  modelVersion?: string
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
  }
}

export function createGeminiProvider(options?: {
  apiKey?: string
  baseUrl?: string
  fetchFn?: typeof fetch
}): AIProvider {
  const apiKey = () => options?.apiKey ?? process.env.GEMINI_API_KEY ?? ''
  const baseUrl = options?.baseUrl ?? 'https://generativelanguage.googleapis.com'
  const fetchFn = options?.fetchFn ?? fetch

  return {
    name: 'gemini',
    isConfigured: () => apiKey().length > 0,
    async complete(request: AIRequest): Promise<AIResponse> {
      if (!apiKey()) throw new AIProviderError('gemini', 'GEMINI_API_KEY is not configured')

      const systemText = request.messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n\n')

      const contents = request.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }))

      const started = Date.now()
      // The key travels as a header rather than a query parameter so it
      // cannot leak through request logs or referrers.
      const response = await fetchFn(
        `${baseUrl}/v1beta/models/${encodeURIComponent(request.model)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': apiKey(),
          },
          body: JSON.stringify({
            contents,
            ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
            generationConfig: {
              maxOutputTokens: request.maxTokens ?? 2048,
              ...(request.temperature != null ? { temperature: request.temperature } : {}),
            },
          }),
        }
      )

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new AIProviderError(
          'gemini',
          `Gemini API error ${response.status}: ${body.slice(0, 500)}`,
          response.status
        )
      }

      const data = (await response.json()) as GeminiResponse
      const text = (data.candidates ?? [])
        .flatMap((c) => c.content?.parts ?? [])
        .map((p) => p.text)
        .filter((t): t is string => typeof t === 'string')
        .join('')

      const usage = data.usageMetadata
      return {
        text,
        // Gemini echoes the resolved model as `modelVersion`; fall back to
        // what we asked for so the field is never empty.
        model: data.modelVersion ?? request.model,
        provider: 'gemini',
        usage: usage
          ? {
              inputTokens: usage.promptTokenCount ?? 0,
              outputTokens: usage.candidatesTokenCount ?? 0,
            }
          : null,
        latencyMs: Date.now() - started,
      }
    },
  }
}
