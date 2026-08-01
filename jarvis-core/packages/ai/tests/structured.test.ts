import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createRouter, type RouterEnv } from '../src/router'
import { completeStructured, extractJson } from '../src/structured'
import type { AIProvider, AIRequest, AIResponse } from '../src/types'

const env: RouterEnv = {
  executiveModel: 'm',
  documentModel: 'm',
  extractionModel: 'm',
  reviewModel: 'm',
}

function scriptedProvider(responses: string[]): AIProvider & { calls: AIRequest[] } {
  const calls: AIRequest[] = []
  let i = 0
  return {
    name: 'openai',
    calls,
    isConfigured: () => true,
    async complete(request: AIRequest): Promise<AIResponse> {
      calls.push(request)
      const text = responses[Math.min(i, responses.length - 1)] ?? ''
      i++
      return { text, model: request.model, provider: 'openai', usage: null, latencyMs: 1 }
    },
  }
}

describe('extractJson', () => {
  it('extracts fenced JSON', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}')
  })
  it('extracts JSON with trailing prose', () => {
    expect(extractJson('{"a":{"b":[1,2]}} hope that helps!')).toBe('{"a":{"b":[1,2]}}')
  })
  it('handles braces inside strings', () => {
    expect(extractJson('{"a":"}{"} trailing')).toBe('{"a":"}{"}')
  })
  it('returns null when no JSON exists', () => {
    expect(extractJson('sorry, I cannot')).toBeNull()
  })
})

describe('completeStructured', () => {
  const schema = z.object({ name: z.string(), count: z.number().int().min(0) })

  it('parses and validates a good response', async () => {
    const router = createRouter([scriptedProvider(['{"name":"forge","count":3}'])], env)
    const result = await completeStructured(router, 'extraction', schema, [
      { role: 'user', content: 'count' },
    ])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.data).toEqual({ name: 'forge', count: 3 })
      expect(result.value.retried).toBe(false)
    }
  })

  it('retries once with feedback after invalid output, then succeeds', async () => {
    const provider = scriptedProvider(['not json at all', '{"name":"forge","count":1}'])
    const router = createRouter([provider], env)
    const result = await completeStructured(router, 'extraction', schema, [
      { role: 'user', content: 'count' },
    ])
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.retried).toBe(true)
    expect(provider.calls.length).toBe(2)
    const lastCall = provider.calls[1]
    expect(lastCall?.messages.some((m) => m.content.includes('rejected'))).toBe(true)
  })

  it('fails after schema-invalid retry (never trusts free text)', async () => {
    const provider = scriptedProvider(['{"name":"forge","count":-2}'])
    const router = createRouter([provider], env)
    const result = await completeStructured(router, 'extraction', schema, [
      { role: 'user', content: 'count' },
    ])
    expect(result.ok).toBe(false)
    expect(provider.calls.length).toBe(2)
  })
})
