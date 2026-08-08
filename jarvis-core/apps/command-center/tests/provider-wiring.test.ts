import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGeminiProvider, createRouter } from '@jarvis/ai'

// ---------------------------------------------------------------------
// Two different questions, both required before this merges:
//
//   1. Does the Gemini adapter actually route end to end — real adapter,
//      real router, mocked transport only?
//   2. Does the APPLICATION construct it? A provider the router supports
//      but the app never registers is unreachable in production, which is
//      indistinguishable from not having built it.
//
// (2) is the one that found a defect: getRouter() and providerStatus() in
// lib/jarvis.ts knew only about Anthropic and OpenAI.
// ---------------------------------------------------------------------

const GEMINI_OK = {
  candidates: [{ content: { parts: [{ text: 'extracted' }] } }],
  modelVersion: 'gemini-2.5-flash-002',
  usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 8 },
}

describe('Gemini routes end to end through the real adapter', () => {
  it('serves the extraction route and reports itself as the answering provider', async () => {
    const calls: string[] = []
    const gemini = createGeminiProvider({
      apiKey: 'test-key',
      fetchFn: (async (url: string) => {
        calls.push(String(url))
        return new Response(JSON.stringify(GEMINI_OK), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }) as unknown as typeof fetch,
    })

    const router = createRouter([gemini], {
      providerModels: { gemini: { extraction: 'gemini-2.5-flash' } },
    })

    const result = await router.complete('extraction', {
      messages: [{ role: 'user', content: 'extract the structure' }],
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.provider).toBe('gemini')
      expect(result.value.text).toBe('extracted')
      expect(result.value.usage).toEqual({ inputTokens: 40, outputTokens: 8 })
    }
    // The model reached the URL, so route → model resolution worked.
    expect(calls[0]).toContain('gemini-2.5-flash:generateContent')
  })

  it('falls through to another provider when Gemini is down, reporting who answered', async () => {
    const gemini = createGeminiProvider({
      apiKey: 'k',
      fetchFn: (async () =>
        new Response('upstream unavailable', { status: 503 })) as unknown as typeof fetch,
    })
    const anthropic = {
      name: 'anthropic' as const,
      isConfigured: () => true,
      complete: async () => ({
        text: 'fallback answer',
        model: 'claude-x',
        provider: 'anthropic' as const,
        usage: null,
        latencyMs: 1,
      }),
    }

    const router = createRouter(
      [gemini, anthropic],
      {
        providerModels: { gemini: { default: 'gemini-flash' }, anthropic: { default: 'claude-x' } },
      },
      // One attempt each: this asserts routing, not retry behaviour.
      { maxAttempts: 1 }
    )

    const result = await router.completeWithStats('extraction', {
      messages: [{ role: 'user', content: 'x' }],
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.response.provider).toBe('anthropic')
      expect(result.value.stats.map((s) => s.provider)).toEqual(['gemini', 'anthropic'])
      expect(result.value.stats[0]?.succeeded).toBe(false)
      expect(result.value.stats[1]?.succeeded).toBe(true)
    }
  })
})

describe('the application registers every configured provider', () => {
  const saved = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    process.env = { ...saved }
  })

  it('constructs Gemini when GEMINI_API_KEY is set', async () => {
    process.env.ANTHROPIC_API_KEY = ''
    process.env.OPENAI_API_KEY = ''
    process.env.GEMINI_API_KEY = 'test-key'
    process.env.JARVIS_MODEL_GEMINI = 'gemini-2.5-flash'

    const { getRouter } = await import('@/lib/jarvis')
    const router = getRouter()

    // Before this test, getRouter() built only Anthropic and OpenAI, so a
    // Gemini-only deployment had no router at all.
    expect(router).not.toBeNull()
    expect(router?.availableProviders()).toContain('gemini')
  })

  it('reports Gemini in provider status', async () => {
    process.env.GEMINI_API_KEY = 'test-key'
    const { providerStatus } = await import('@/lib/jarvis')
    expect(providerStatus().gemini).toBe(true)
  })

  it('still returns no router when nothing is configured', async () => {
    process.env.ANTHROPIC_API_KEY = ''
    process.env.OPENAI_API_KEY = ''
    process.env.GEMINI_API_KEY = ''

    const { getRouter } = await import('@/lib/jarvis')
    expect(getRouter()).toBeNull()
  })
})
