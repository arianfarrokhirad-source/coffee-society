import { describe, expect, it } from 'vitest'
import { createGeminiProvider } from '../src/providers/gemini'
import { AIProviderError } from '../src/types'

// These pin the two things an adapter exists to absorb: the wire shape
// of one vendor, and the promise that a missing credential degrades
// rather than crashes.

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const OK_BODY = {
  candidates: [{ content: { parts: [{ text: 'hello from ' }, { text: 'gemini' }] } }],
  modelVersion: 'gemini-2.5-flash-002',
  usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 4 },
}

describe('credential handling never throws on import or probe', () => {
  it('reports unconfigured instead of throwing when the key is absent', () => {
    const provider = createGeminiProvider({ apiKey: '' })
    expect(provider.isConfigured()).toBe(false)
    expect(provider.name).toBe('gemini')
  })

  it('throws a typed provider error only when actually called unconfigured', async () => {
    const provider = createGeminiProvider({ apiKey: '' })
    await expect(
      provider.complete({ model: 'gemini-2.5-flash', messages: [{ role: 'user', content: 'x' }] })
    ).rejects.toBeInstanceOf(AIProviderError)
  })
})

describe('request shaping is Gemini-specific and stays inside the adapter', () => {
  it('maps the assistant role to "model" and lifts system into systemInstruction', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    const provider = createGeminiProvider({
      apiKey: 'test-key',
      fetchFn: (async (url: string, init: RequestInit) => {
        captured = { url, init }
        return jsonResponse(OK_BODY)
      }) as unknown as typeof fetch,
    })

    await provider.complete({
      model: 'gemini-2.5-flash',
      messages: [
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
        { role: 'user', content: 'again' },
      ],
      maxTokens: 256,
      temperature: 0.2,
    })

    expect(captured).not.toBeNull()
    const sent = JSON.parse(String(captured!.init.body))

    // "system" is not a content role for Gemini.
    expect(sent.contents.map((c: { role: string }) => c.role)).toEqual(['user', 'model', 'user'])
    expect(sent.systemInstruction.parts[0].text).toBe('be terse')
    expect(sent.generationConfig.maxOutputTokens).toBe(256)
    expect(sent.generationConfig.temperature).toBe(0.2)
  })

  it('sends the key as a header, never in the URL', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    const provider = createGeminiProvider({
      apiKey: 'secret-key-value',
      fetchFn: (async (url: string, init: RequestInit) => {
        captured = { url, init }
        return jsonResponse(OK_BODY)
      }) as unknown as typeof fetch,
    })

    await provider.complete({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'x' }],
    })

    // A key in the query string leaks through logs, proxies and referrers.
    expect(captured!.url).not.toContain('secret-key-value')
    expect((captured!.init.headers as Record<string, string>)['x-goog-api-key']).toBe(
      'secret-key-value'
    )
  })

  it('omits temperature entirely when it was not requested', async () => {
    let body: { generationConfig: Record<string, unknown> } | null = null
    const provider = createGeminiProvider({
      apiKey: 'k',
      fetchFn: (async (_url: string, init: RequestInit) => {
        body = JSON.parse(String(init.body))
        return jsonResponse(OK_BODY)
      }) as unknown as typeof fetch,
    })
    await provider.complete({ model: 'm', messages: [{ role: 'user', content: 'x' }] })
    expect(body).not.toBeNull()
    expect('temperature' in body!.generationConfig).toBe(false)
    expect(body!.generationConfig.maxOutputTokens).toBe(2048)
  })
})

describe('response normalisation', () => {
  it('joins multi-part text and maps usage into the shared shape', async () => {
    const provider = createGeminiProvider({
      apiKey: 'k',
      fetchFn: (async () => jsonResponse(OK_BODY)) as unknown as typeof fetch,
    })
    const result = await provider.complete({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'x' }],
    })

    expect(result.text).toBe('hello from gemini')
    expect(result.provider).toBe('gemini')
    expect(result.model).toBe('gemini-2.5-flash-002')
    expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 4 })
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('survives a response with no candidates, usage or modelVersion', async () => {
    const provider = createGeminiProvider({
      apiKey: 'k',
      fetchFn: (async () => jsonResponse({})) as unknown as typeof fetch,
    })
    const result = await provider.complete({
      model: 'asked-for-this',
      messages: [{ role: 'user', content: 'x' }],
    })
    expect(result.text).toBe('')
    expect(result.usage).toBeNull()
    // Falls back to the requested model rather than an empty string.
    expect(result.model).toBe('asked-for-this')
  })

  it('raises AIProviderError carrying the HTTP status, without leaking the body wholesale', async () => {
    const provider = createGeminiProvider({
      apiKey: 'k',
      fetchFn: (async () =>
        new Response('quota exceeded for project 12345', {
          status: 429,
        })) as unknown as typeof fetch,
    })

    await expect(
      provider.complete({ model: 'm', messages: [{ role: 'user', content: 'x' }] })
    ).rejects.toMatchObject({ provider: 'gemini', status: 429 })
  })
})
