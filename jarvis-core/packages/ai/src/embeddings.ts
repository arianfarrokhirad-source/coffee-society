import type { AIProviderName } from '@jarvis/shared'
import { err, ok, type Result } from '@jarvis/shared'
import { withRetry, type RetryPolicy } from './retry'
import type { AIProvider, EmbeddingTaskType } from './types'

// ---------------------------------------------------------------------
// Embeddings.
//
// Same shape as the completion router deliberately: ordered preference,
// configured-provider filtering, no vendor hard-coded as the default.
//
// One rule dominates everything downstream. A vector is a coordinate in a
// space defined by (provider, model, task type). Vectors from different
// spaces are NOT comparable — cosine similarity between them still
// returns a number between -1 and 1, which is exactly what makes the
// mistake so durable: nothing crashes, results just quietly stop being
// relevant. So every stored vector carries the space it was produced in,
// and searching across a mismatched space is refused rather than
// silently answered.
// ---------------------------------------------------------------------

/**
 * Anthropic is absent because it ships no embedding endpoint. This is an
 * ordering of providers that can actually do the work, not a wish list.
 */
const EMBEDDING_PREFERENCE: readonly AIProviderName[] = ['gemini', 'openai']

export interface EmbeddingEnv {
  /** Per-provider embedding model, from JARVIS_EMBEDDING_<PROVIDER>. */
  models?: Partial<Record<AIProviderName, string>>
  /** Optional width request, from JARVIS_EMBEDDING_DIMENSIONS. */
  dimensions?: number
}

export function readEmbeddingEnv(): EmbeddingEnv {
  const models: Partial<Record<AIProviderName, string>> = {}
  for (const provider of EMBEDDING_PREFERENCE) {
    const configured = process.env[`JARVIS_EMBEDDING_${provider.toUpperCase()}`]
    if (configured) models[provider] = configured
  }
  const rawDimensions = process.env.JARVIS_EMBEDDING_DIMENSIONS
  const dimensions = rawDimensions ? Number(rawDimensions) : undefined

  return {
    ...(Object.keys(models).length > 0 ? { models } : {}),
    // A non-numeric or absurd value is dropped rather than passed to the
    // provider, where it would fail every call in the run.
    ...(dimensions != null && Number.isInteger(dimensions) && dimensions > 0 ? { dimensions } : {}),
  }
}

/**
 * A vector plus the space it belongs to.
 *
 * The three identity fields are not metadata for humans — they are the
 * compatibility key. Persist them alongside the vector; a stored vector
 * without them cannot be safely used again once the model is upgraded,
 * and re-embedding a corpus to recover that information is expensive.
 */
export interface EmbeddedVector {
  index: number
  values: number[]
  provider: AIProviderName
  model: string
  taskType: EmbeddingTaskType
}

export interface EmbeddingRoute {
  provider: AIProviderName
  model: string
}

export interface EmbedBatchResult {
  vectors: EmbeddedVector[]
  provider: AIProviderName
  model: string
  taskType: EmbeddingTaskType
  /** Provider calls made — inputs split across the provider's limit. */
  calls: number
  latencyMs: number
}

export interface EmbeddingClient {
  resolveRoute(): Result<EmbeddingRoute>
  /**
   * Embeds every input, splitting across the provider's batch ceiling.
   * Returned vectors are in request order regardless of how many calls
   * the split required.
   */
  embed(inputs: string[], taskType: EmbeddingTaskType): Promise<Result<EmbedBatchResult>>
}

export function createEmbeddingClient(
  providers: AIProvider[],
  env?: EmbeddingEnv,
  retryPolicy?: RetryPolicy
): EmbeddingClient {
  const byName = new Map<AIProviderName, AIProvider>(providers.map((p) => [p.name, p]))
  const config = env ?? readEmbeddingEnv()

  function resolveRoute(): Result<EmbeddingRoute> {
    for (const name of EMBEDDING_PREFERENCE) {
      const provider = byName.get(name)
      // embed() being optional is load-bearing: a provider that cannot
      // embed is skipped here rather than throwing at call time.
      if (!provider?.isConfigured() || typeof provider.embed !== 'function') continue
      const model = config.models?.[name]
      if (!model) continue
      return ok({ provider: name, model })
    }
    return err('No embedding provider available. Set an API key and JARVIS_EMBEDDING_<PROVIDER>.')
  }

  async function embed(
    inputs: string[],
    taskType: EmbeddingTaskType
  ): Promise<Result<EmbedBatchResult>> {
    const route = resolveRoute()
    if (!route.ok) return route

    const provider = byName.get(route.value.provider)
    const embedFn = provider?.embed
    if (!provider || !embedFn) return err('Embedding provider disappeared during routing.')

    // Blank inputs are dropped before the call, not after: providers
    // reject empty strings, and one blank line in a document would
    // otherwise fail the whole batch. Their positions are not reused,
    // so surviving indexes stay aligned with the caller's array.
    const usable = inputs
      .map((text, index) => ({ text, index }))
      .filter((entry) => entry.text.trim().length > 0)

    const limit = provider.maxEmbeddingBatch ?? 1
    const vectors: EmbeddedVector[] = []
    const started = Date.now()
    let calls = 0

    for (let offset = 0; offset < usable.length; offset += limit) {
      const slice = usable.slice(offset, offset + limit)
      calls += 1

      const outcome = await withRetry(
        () =>
          embedFn.call(provider, {
            model: route.value.model,
            inputs: slice.map((entry) => entry.text),
            taskType,
            ...(config.dimensions != null ? { dimensions: config.dimensions } : {}),
          }),
        retryPolicy
      )

      if (!outcome.ok || !outcome.value) {
        const cause = outcome.error
        // Partial success is not reported as success. Half an index is
        // worse than none: queries return confident answers drawn from
        // whichever half happened to land.
        return err(
          `Embedding failed on batch ${calls} of ${Math.ceil(usable.length / limit)}: ${
            cause instanceof Error ? cause.message : 'unknown error'
          }`
        )
      }

      for (const vector of outcome.value.vectors) {
        const source = slice[vector.index]
        if (!source) continue
        vectors.push({
          index: source.index,
          values: vector.values,
          provider: route.value.provider,
          model: route.value.model,
          taskType,
        })
      }
    }

    return ok({
      vectors,
      provider: route.value.provider,
      model: route.value.model,
      taskType,
      calls,
      latencyMs: Date.now() - started,
    })
  }

  return { resolveRoute, embed }
}

/**
 * Cosine similarity, refusing incomparable inputs.
 *
 * Returns null rather than a number when the vectors cannot be compared
 * — different widths, or a zero vector, which has no direction and so no
 * meaningful angle to anything. Returning 0 for those cases would be a
 * lie shaped exactly like a valid answer ("unrelated"), and callers
 * ranking by score would never notice.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number | null {
  if (a.length === 0 || a.length !== b.length) return null

  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    dot += x * y
    normA += x * x
    normB += y * y
  }

  if (normA === 0 || normB === 0) return null
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/** True when two vectors were produced in the same embedding space. */
export function isComparable(
  a: Pick<EmbeddedVector, 'provider' | 'model' | 'taskType'>,
  b: Pick<EmbeddedVector, 'provider' | 'model' | 'taskType'>
): boolean {
  // Task type is deliberately excluded from the equality check: the
  // whole point of asymmetric embeddings is that a `query` vector is
  // MEANT to be compared against `document` vectors. Provider and model
  // must match; the sides are expected to differ.
  return a.provider === b.provider && a.model === b.model
}

/** Ranked nearest neighbours, skipping anything incomparable. */
export function rankBySimilarity<T extends EmbeddedVector>(
  query: EmbeddedVector,
  candidates: readonly T[],
  options?: { limit?: number; minScore?: number }
): { item: T; score: number }[] {
  const scored: { item: T; score: number }[] = []
  for (const candidate of candidates) {
    if (!isComparable(query, candidate)) continue
    const score = cosineSimilarity(query.values, candidate.values)
    if (score == null) continue
    if (options?.minScore != null && score < options.minScore) continue
    scored.push({ item: candidate, score })
  }
  scored.sort((left, right) => right.score - left.score)
  return options?.limit != null ? scored.slice(0, options.limit) : scored
}
