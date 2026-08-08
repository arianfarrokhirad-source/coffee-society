import { describe, expect, it } from 'vitest'
import { createGeminiProvider } from '../src/providers/gemini'
import { AIProviderError } from '../src/types'

// The embedding half of the Gemini adapter. Same job as the completion
// half: absorb one vendor's wire shape so nothing above it has to know.

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function embedBody(count: number, width = 4) {
  return {
    embeddings: Array.from({ length: count }, (_, i) => ({
      values: Array.from({ length: width }, (_, d) => (i + 1) / (d + 1)),
    })),
  }
}

describe('Gemini embedding request shaping', () => {
  it('qualifies a bare model id and repeats it per request', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    const provider = createGeminiProvider({
      apiKey: 'k',
      fetchFn: (async (url: string, init: RequestInit) => {
        captured = { url, init }
        return jsonResponse(embedBody(2))
      }) as unknown as typeof fetch,
    })

    await provider.embed?.({
      model: 'gemini-embedding-001',
      inputs: ['alpha', 'beta'],
      taskType: 'document',
    })

    const call = captured as unknown as { url: string; init: RequestInit }
    expect(call.url).toContain('models/gemini-embedding-001:batchEmbedContents')

    const body = JSON.parse(String(call.init.body)) as {
      requests: { model: string; taskType: string; content: { parts: { text: string }[] } }[]
    }
    // The per-request `model` is required by this endpoint even though
    // it repeats what is already in the URL.
    expect(body.requests).toHaveLength(2)
    expect(body.requests[0]?.model).toBe('models/gemini-embedding-001')
    expect(body.requests[0]?.content.parts[0]?.text).toBe('alpha')
  })

  it('does not double-prefix a model id that is already qualified', async () => {
    let url = ''
    const provider = createGeminiProvider({
      apiKey: 'k',
      fetchFn: (async (requestUrl: string) => {
        url = requestUrl
        return jsonResponse(embedBody(1))
      }) as unknown as typeof fetch,
    })

    await provider.embed?.({ model: 'models/gemini-embedding-001', inputs: ['a'] })
    expect(url).not.toContain('models/models/')
  })

  it('translates neutral task types into Gemini’s vocabulary', async () => {
    const captured: string[] = []
    const provider = createGeminiProvider({
      apiKey: 'k',
      fetchFn: (async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { requests: { taskType?: string }[] }
        captured.push(body.requests[0]?.taskType ?? 'absent')
        return jsonResponse(embedBody(1))
      }) as unknown as typeof fetch,
    })

    await provider.embed?.({ model: 'm', inputs: ['a'], taskType: 'document' })
    await provider.embed?.({ model: 'm', inputs: ['a'], taskType: 'query' })
    await provider.embed?.({ model: 'm', inputs: ['a'], taskType: 'code_query' })
    await provider.embed?.({ model: 'm', inputs: ['a'] })

    expect(captured).toEqual([
      'RETRIEVAL_DOCUMENT',
      'RETRIEVAL_QUERY',
      'CODE_RETRIEVAL_QUERY',
      'absent',
    ])
  })

  it('sends the API key as a header, never in the URL', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    const provider = createGeminiProvider({
      apiKey: 'super-secret-key',
      fetchFn: (async (url: string, init: RequestInit) => {
        captured = { url, init }
        return jsonResponse(embedBody(1))
      }) as unknown as typeof fetch,
    })

    await provider.embed?.({ model: 'm', inputs: ['a'] })

    const call = captured as unknown as { url: string; init: RequestInit }
    // A key in the query string leaks through request logs and referrers.
    expect(call.url).not.toContain('super-secret-key')
    expect((call.init.headers as Record<string, string>)['x-goog-api-key']).toBe('super-secret-key')
  })
})

describe('Gemini embedding failure handling', () => {
  it('refuses an over-limit batch locally instead of sending it', async () => {
    // A 400 from the provider classifies as non-retryable and would abort
    // an indexing run, when the real fix is simply to split the batch.
    let called = false
    const provider = createGeminiProvider({
      apiKey: 'k',
      fetchFn: (async () => {
        called = true
        return jsonResponse(embedBody(1))
      }) as unknown as typeof fetch,
    })

    await expect(
      provider.embed?.({ model: 'm', inputs: Array.from({ length: 101 }, () => 'x') })
    ).rejects.toBeInstanceOf(AIProviderError)
    expect(called).toBe(false)
  })

  it('declares its batch ceiling so callers can split correctly', () => {
    expect(createGeminiProvider({ apiKey: 'k' }).maxEmbeddingBatch).toBe(100)
  })

  it('treats an empty batch as a no-op rather than an error', async () => {
    let called = false
    const provider = createGeminiProvider({
      apiKey: 'k',
      fetchFn: (async () => {
        called = true
        return jsonResponse(embedBody(0))
      }) as unknown as typeof fetch,
    })

    const result = await provider.embed?.({ model: 'm', inputs: [] })
    expect(result?.vectors).toEqual([])
    expect(called).toBe(false)
  })

  it('rejects a short response rather than misaligning every later vector', async () => {
    // Position is the only thing tying a vector to its source text — the
    // response carries no ids. A short response would shift every
    // subsequent vector onto the wrong document.
    const provider = createGeminiProvider({
      apiKey: 'k',
      fetchFn: (async () => jsonResponse(embedBody(2))) as unknown as typeof fetch,
    })

    await expect(provider.embed?.({ model: 'm', inputs: ['a', 'b', 'c'] })).rejects.toMatchObject({
      provider: 'gemini',
    })
  })

  it('carries the HTTP status so the retry layer can classify it', async () => {
    const provider = createGeminiProvider({
      apiKey: 'k',
      fetchFn: (async () =>
        new Response('rate limited', {
          status: 429,
          headers: { 'retry-after': '2' },
        })) as unknown as typeof fetch,
    })

    await expect(provider.embed?.({ model: 'm', inputs: ['a'] })).rejects.toMatchObject({
      provider: 'gemini',
      status: 429,
      retryAfterMs: 2_000,
    })
  })

  it('throws a typed error when unconfigured', async () => {
    const provider = createGeminiProvider({ apiKey: '' })
    await expect(provider.embed?.({ model: 'm', inputs: ['a'] })).rejects.toBeInstanceOf(
      AIProviderError
    )
  })

  it('reports the vector width it actually received', async () => {
    const provider = createGeminiProvider({
      apiKey: 'k',
      fetchFn: (async () => jsonResponse(embedBody(3, 768))) as unknown as typeof fetch,
    })

    const result = await provider.embed?.({ model: 'm', inputs: ['a', 'b', 'c'] })
    expect(result?.dimensions).toBe(768)
    expect(result?.vectors).toHaveLength(3)
    expect(result?.vectors[0]?.values).toHaveLength(768)
  })

  it('reports usage as null rather than inventing a zero', async () => {
    // batchEmbedContents returns no usage metadata. A fabricated 0 would
    // understate spend in every cost report.
    const provider = createGeminiProvider({
      apiKey: 'k',
      fetchFn: (async () => jsonResponse(embedBody(1))) as unknown as typeof fetch,
    })

    const result = await provider.embed?.({ model: 'm', inputs: ['a'] })
    expect(result?.usage).toBeNull()
  })
})
