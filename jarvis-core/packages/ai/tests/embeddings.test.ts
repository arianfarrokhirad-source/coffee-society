import { describe, expect, it, vi } from 'vitest'
import {
  cosineSimilarity,
  createEmbeddingClient,
  isComparable,
  rankBySimilarity,
  type EmbeddedVector,
} from '../src/embeddings'
import type { AIProvider, EmbeddingRequest, EmbeddingResponse } from '../src/types'
import { AIProviderError } from '../src/types'

// Embeddings fail quietly rather than loudly — a mismatched vector space
// still returns a plausible number, so nothing crashes and retrieval just
// gets worse. These tests pin the invariants that keep that from
// happening silently.

function fakeEmbedder(options?: {
  name?: 'gemini' | 'openai' | 'anthropic'
  configured?: boolean
  maxBatch?: number
  dimensions?: number
  onEmbed?: (request: EmbeddingRequest) => void
  fail?: () => Error
  short?: boolean
}): AIProvider {
  const name = options?.name ?? 'gemini'
  return {
    name,
    isConfigured: () => options?.configured !== false,
    ...(options?.maxBatch != null ? { maxEmbeddingBatch: options.maxBatch } : {}),
    complete: async () => {
      throw new Error('not used')
    },
    async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
      options?.onEmbed?.(request)
      if (options?.fail) throw options.fail()
      const width = options?.dimensions ?? 3
      const count = options?.short ? request.inputs.length - 1 : request.inputs.length
      return {
        provider: name,
        model: request.model,
        vectors: Array.from({ length: Math.max(0, count) }, (_, index) => ({
          index,
          values: Array.from({ length: width }, (_, d) => (index + 1) * (d + 1)),
        })),
        usage: null,
        latencyMs: 1,
        dimensions: width,
      }
    },
  }
}

/** A provider with no embed() at all — Anthropic's real situation. */
const nonEmbedder: AIProvider = {
  name: 'anthropic',
  isConfigured: () => true,
  complete: async () => {
    throw new Error('not used')
  },
}

describe('embedding route resolution', () => {
  it('skips a provider that cannot embed at all', () => {
    // embed() being optional is load-bearing: Anthropic must be passed
    // over here, not throw at call time.
    const client = createEmbeddingClient([nonEmbedder], {
      models: { anthropic: 'claude-embed', gemini: 'gemini-embedding-001' },
    })
    expect(client.resolveRoute().ok).toBe(false)
  })

  it('skips a configured provider with no model set', () => {
    const client = createEmbeddingClient([fakeEmbedder()], {})
    const route = client.resolveRoute()
    expect(route.ok).toBe(false)
    if (!route.ok) expect(route.error).toMatch(/JARVIS_EMBEDDING/)
  })

  it('skips a provider with a model but no credential', () => {
    const client = createEmbeddingClient([fakeEmbedder({ configured: false })], {
      models: { gemini: 'gemini-embedding-001' },
    })
    expect(client.resolveRoute().ok).toBe(false)
  })

  it('prefers Gemini, then falls back to OpenAI', () => {
    const both = createEmbeddingClient(
      [fakeEmbedder({ name: 'openai' }), fakeEmbedder({ name: 'gemini' })],
      { models: { gemini: 'gemini-embedding-001', openai: 'text-embedding-3-small' } }
    )
    const route = both.resolveRoute()
    expect(route.ok && route.value.provider).toBe('gemini')

    const openaiOnly = createEmbeddingClient([fakeEmbedder({ name: 'openai' })], {
      models: { openai: 'text-embedding-3-small' },
    })
    const fallback = openaiOnly.resolveRoute()
    expect(fallback.ok && fallback.value.provider).toBe('openai')
  })
})

describe('batching across the provider limit', () => {
  it('splits inputs into calls no larger than the provider allows', async () => {
    const seen: number[] = []
    const client = createEmbeddingClient(
      [fakeEmbedder({ maxBatch: 4, onEmbed: (r) => void seen.push(r.inputs.length) })],
      { models: { gemini: 'gemini-embedding-001' } }
    )

    const result = await client.embed(
      Array.from({ length: 10 }, (_, i) => `text ${i}`),
      'document'
    )

    expect(result.ok).toBe(true)
    expect(seen).toEqual([4, 4, 2])
    if (result.ok) {
      expect(result.value.calls).toBe(3)
      expect(result.value.vectors).toHaveLength(10)
    }
  })

  it('keeps vectors aligned to the caller’s original indexes', async () => {
    const client = createEmbeddingClient([fakeEmbedder({ maxBatch: 2 })], {
      models: { gemini: 'gemini-embedding-001' },
    })
    const result = await client.embed(['a', 'b', 'c', 'd', 'e'], 'document')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.vectors.map((v) => v.index)).toEqual([0, 1, 2, 3, 4])
    }
  })

  it('drops blank inputs without shifting the surviving indexes', async () => {
    // One blank line in a document would otherwise fail the whole batch,
    // and renumbering would attach vectors to the wrong source text.
    const client = createEmbeddingClient([fakeEmbedder({ maxBatch: 10 })], {
      models: { gemini: 'gemini-embedding-001' },
    })
    const result = await client.embed(['first', '   ', 'third'], 'document')

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.vectors.map((v) => v.index)).toEqual([0, 2])
  })

  it('reports failure rather than returning a half-built index', async () => {
    // Half an index is worse than none: queries return confident answers
    // drawn from whichever half happened to land.
    const client = createEmbeddingClient(
      [
        fakeEmbedder({
          maxBatch: 2,
          fail: () => new AIProviderError('gemini', 'quota exhausted', 403),
        }),
      ],
      { models: { gemini: 'gemini-embedding-001' } }
    )

    const result = await client.embed(['a', 'b', 'c'], 'document')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/quota exhausted/)
  })

  it('stamps every vector with the space it was produced in', async () => {
    const client = createEmbeddingClient([fakeEmbedder()], {
      models: { gemini: 'gemini-embedding-001' },
    })
    const result = await client.embed(['a'], 'query')

    expect(result.ok).toBe(true)
    if (result.ok) {
      const vector = result.value.vectors[0]
      expect(vector?.provider).toBe('gemini')
      expect(vector?.model).toBe('gemini-embedding-001')
      expect(vector?.taskType).toBe('query')
    }
  })

  it('passes the task type through to the provider', async () => {
    const onEmbed = vi.fn()
    const client = createEmbeddingClient([fakeEmbedder({ onEmbed })], {
      models: { gemini: 'gemini-embedding-001' },
    })
    await client.embed(['a'], 'code_query')
    expect(onEmbed).toHaveBeenCalledWith(expect.objectContaining({ taskType: 'code_query' }))
  })

  it('handles an all-blank input list without calling the provider', async () => {
    const onEmbed = vi.fn()
    const client = createEmbeddingClient([fakeEmbedder({ onEmbed })], {
      models: { gemini: 'gemini-embedding-001' },
    })
    const result = await client.embed(['  ', ''], 'document')

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.vectors).toEqual([])
    expect(onEmbed).not.toHaveBeenCalled()
  })
})

describe('cosineSimilarity', () => {
  it('scores identical direction as 1 and opposite as -1', () => {
    expect(cosineSimilarity([1, 0], [2, 0])).toBeCloseTo(1)
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1)
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
  })

  it('refuses vectors of different widths', () => {
    // Two models' outputs are not comparable. Returning a number here
    // would be a lie shaped exactly like a valid answer.
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBeNull()
  })

  it('refuses a zero vector rather than scoring it 0', () => {
    // A zero vector has no direction. 0 means "unrelated", which is a
    // real score a caller would rank on.
    expect(cosineSimilarity([0, 0], [1, 1])).toBeNull()
  })

  it('refuses empty vectors', () => {
    expect(cosineSimilarity([], [])).toBeNull()
  })
})

describe('comparability across embedding spaces', () => {
  const base: Omit<EmbeddedVector, 'values' | 'index'> = {
    provider: 'gemini',
    model: 'gemini-embedding-001',
    taskType: 'document',
  }

  it('treats query and document vectors from one model as comparable', () => {
    // This is the entire point of asymmetric embeddings — the sides are
    // MEANT to differ, so task type must not break comparability.
    expect(isComparable(base, { ...base, taskType: 'query' })).toBe(true)
  })

  it('refuses vectors from a different model', () => {
    expect(isComparable(base, { ...base, model: 'gemini-embedding-002' })).toBe(false)
  })

  it('refuses vectors from a different provider', () => {
    expect(isComparable(base, { ...base, provider: 'openai' })).toBe(false)
  })

  it('excludes incomparable candidates from ranking instead of scoring them', () => {
    const query: EmbeddedVector = { index: 0, values: [1, 0], ...base, taskType: 'query' }
    const candidates: EmbeddedVector[] = [
      { index: 0, values: [1, 0], ...base },
      { index: 1, values: [0.9, 0.1], ...base },
      { index: 2, values: [1, 0], ...base, model: 'other-model' },
    ]

    const ranked = rankBySimilarity(query, candidates)
    expect(ranked).toHaveLength(2)
    expect(ranked[0]?.item.index).toBe(0)
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 1)
  })

  it('applies a minimum score and a limit', () => {
    const query: EmbeddedVector = { index: 0, values: [1, 0], ...base, taskType: 'query' }
    const candidates: EmbeddedVector[] = [
      { index: 0, values: [1, 0], ...base },
      { index: 1, values: [0, 1], ...base },
    ]

    expect(rankBySimilarity(query, candidates, { minScore: 0.5 })).toHaveLength(1)
    expect(rankBySimilarity(query, candidates, { limit: 1 })).toHaveLength(1)
  })
})
