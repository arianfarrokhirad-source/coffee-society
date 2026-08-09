import type {
  AIProvider,
  AIRequest,
  AIResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  EmbeddingTaskType,
  ProviderProbeResult,
} from '../types'
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

interface GeminiEmbedResponse {
  embeddings?: { values?: number[] }[]
}

/**
 * Our neutral task types mapped to Gemini's vocabulary. Keeping the
 * mapping here — not at the call site — is what lets a second embedding
 * provider be added without every caller learning its enum.
 */
const GEMINI_TASK_TYPE: Record<EmbeddingTaskType, string> = {
  document: 'RETRIEVAL_DOCUMENT',
  query: 'RETRIEVAL_QUERY',
  similarity: 'SEMANTIC_SIMILARITY',
  classification: 'CLASSIFICATION',
  clustering: 'CLUSTERING',
  code_query: 'CODE_RETRIEVAL_QUERY',
}

/**
 * Gemini's documented ceiling for batchEmbedContents. Declared so the
 * batching layer can split correctly rather than discovering the limit
 * as an opaque 400 halfway through an indexing run.
 */
const GEMINI_MAX_EMBEDDING_BATCH = 100

/** Gemini names models `models/<id>`; callers pass the bare id. */
function qualifyModel(model: string): string {
  return model.startsWith('models/') ? model : `models/${model}`
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
    maxEmbeddingBatch: GEMINI_MAX_EMBEDDING_BATCH,
    // Costs no tokens: lists models rather than generating any.
    async probe(signal: AbortSignal): Promise<ProviderProbeResult> {
      try {
        const response = await fetchFn(`${baseUrl}/v1beta/models?pageSize=1`, {
          method: 'GET',
          headers: { 'x-goog-api-key': apiKey() },
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
    async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
      if (!apiKey()) throw new AIProviderError('gemini', 'GEMINI_API_KEY is not configured')

      if (request.inputs.length > GEMINI_MAX_EMBEDDING_BATCH) {
        // Refused locally rather than sent and rejected. A 400 here would
        // be classified as non-retryable and abort an indexing run, when
        // the real fix is simply to split the batch.
        throw new AIProviderError(
          'gemini',
          `Gemini accepts at most ${GEMINI_MAX_EMBEDDING_BATCH} inputs per embed call; received ${request.inputs.length}`
        )
      }

      // An empty batch is a no-op, not an error — batching layers produce
      // empty tails routinely and should not have to special-case them.
      if (request.inputs.length === 0) {
        return {
          provider: 'gemini',
          model: request.model,
          vectors: [],
          usage: null,
          latencyMs: 0,
          dimensions: null,
        }
      }

      const qualified = qualifyModel(request.model)
      const started = Date.now()
      const response = await fetchFn(
        `${baseUrl}/v1beta/${encodeURI(qualified)}:batchEmbedContents`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': apiKey(),
          },
          body: JSON.stringify({
            requests: request.inputs.map((text) => ({
              // The per-request `model` is required by this endpoint even
              // though it repeats the one in the URL.
              model: qualified,
              content: { parts: [{ text }] },
              ...(request.taskType ? { taskType: GEMINI_TASK_TYPE[request.taskType] } : {}),
              ...(request.dimensions != null ? { outputDimensionality: request.dimensions } : {}),
            })),
          }),
        }
      )

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new AIProviderError(
          'gemini',
          `Gemini embedding error ${response.status}: ${body.slice(0, 500)}`,
          response.status,
          parseRetryAfter(response.headers.get('retry-after'))
        )
      }

      const data = (await response.json()) as GeminiEmbedResponse
      const embeddings = data.embeddings ?? []

      // Position is the only thing tying a vector back to its source text
      // — the response carries no ids. A short response would silently
      // shift every subsequent vector onto the wrong document, which is
      // corruption that reads as "retrieval got worse" months later.
      if (embeddings.length !== request.inputs.length) {
        throw new AIProviderError(
          'gemini',
          `Gemini returned ${embeddings.length} embeddings for ${request.inputs.length} inputs`
        )
      }

      const vectors = embeddings.map((embedding, index) => ({
        index,
        values: embedding.values ?? [],
      }))

      return {
        provider: 'gemini',
        model: request.model,
        vectors,
        // batchEmbedContents reports no usage metadata. Null says "not
        // reported" — a fabricated 0 would understate spend.
        usage: null,
        latencyMs: Date.now() - started,
        dimensions: vectors[0]?.values.length ?? null,
      }
    },
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
          response.status,
          parseRetryAfter(response.headers.get('retry-after'))
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
