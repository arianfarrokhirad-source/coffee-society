import { describe, expect, it } from 'vitest'
import { createRouter, type RouterEnv } from '../src/router'
import type { AIProvider, AIRequest, AIResponse } from '../src/types'

function mockProvider(
  name: 'anthropic' | 'openai',
  configured: boolean,
  behavior: 'ok' | 'fail' = 'ok'
): AIProvider & { calls: AIRequest[] } {
  const calls: AIRequest[] = []
  return {
    name,
    calls,
    isConfigured: () => configured,
    async complete(request: AIRequest): Promise<AIResponse> {
      calls.push(request)
      if (behavior === 'fail') throw new Error(`${name} unavailable`)
      return {
        text: `${name} says hello`,
        model: request.model,
        provider: name,
        usage: { inputTokens: 10, outputTokens: 5 },
        latencyMs: 1,
      }
    },
  }
}

const env: RouterEnv = {
  executiveModel: 'exec-model',
  documentModel: 'doc-model',
  extractionModel: 'extract-model',
  reviewModel: 'review-model',
}

describe('provider routing policy', () => {
  it('routes document review to Anthropic and executive reasoning to OpenAI', () => {
    const router = createRouter(
      [mockProvider('anthropic', true), mockProvider('openai', true)],
      env
    )
    const doc = router.resolveRoute('document')
    const exec = router.resolveRoute('executive')
    expect(doc.ok && doc.value.provider).toBe('anthropic')
    expect(doc.ok && doc.value.model).toBe('doc-model')
    expect(exec.ok && exec.value.provider).toBe('openai')
    expect(exec.ok && exec.value.model).toBe('exec-model')
  })

  it('routes review to Anthropic and extraction to the economical model', () => {
    const router = createRouter(
      [mockProvider('anthropic', true), mockProvider('openai', true)],
      env
    )
    const review = router.resolveRoute('review')
    const extraction = router.resolveRoute('extraction')
    expect(review.ok && review.value.provider).toBe('anthropic')
    expect(review.ok && review.value.model).toBe('review-model')
    expect(extraction.ok && extraction.value.model).toBe('extract-model')
  })

  it('model names come from environment, never hard-coded', () => {
    const router = createRouter([mockProvider('anthropic', true), mockProvider('openai', true)], {})
    const route = router.resolveRoute('executive')
    expect(route.ok).toBe(false)
  })

  it('falls back to the other provider when the primary is unconfigured', () => {
    const router = createRouter(
      [mockProvider('anthropic', true), mockProvider('openai', false)],
      env
    )
    const exec = router.resolveRoute('executive')
    expect(exec.ok && exec.value.provider).toBe('anthropic')
  })

  it('errors gracefully when no provider is available', () => {
    const router = createRouter(
      [mockProvider('anthropic', false), mockProvider('openai', false)],
      env
    )
    const route = router.resolveRoute('document')
    expect(route.ok).toBe(false)
    if (!route.ok) expect(route.error).toContain('No AI provider available')
  })
})

describe('completion with runtime fallback', () => {
  it('completes with the primary provider', async () => {
    const anthropic = mockProvider('anthropic', true)
    const openai = mockProvider('openai', true)
    const router = createRouter([anthropic, openai], env)
    const result = await router.complete('document', {
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(result.ok && result.value.provider).toBe('anthropic')
    expect(anthropic.calls.length).toBe(1)
    expect(openai.calls.length).toBe(0)
  })

  it('fails over to the other provider when the primary throws', async () => {
    const anthropic = mockProvider('anthropic', true, 'fail')
    const openai = mockProvider('openai', true)
    const router = createRouter([anthropic, openai], env)
    const result = await router.complete('document', {
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(result.ok && result.value.provider).toBe('openai')
    expect(anthropic.calls.length).toBe(1)
    expect(openai.calls.length).toBe(1)
  })

  it('reports a combined error when both providers fail', async () => {
    const router = createRouter(
      [mockProvider('anthropic', true, 'fail'), mockProvider('openai', true, 'fail')],
      env
    )
    const result = await router.complete('review', { messages: [{ role: 'user', content: 'hi' }] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Both providers failed')
  })

  it('lists available providers', () => {
    const router = createRouter(
      [mockProvider('anthropic', true), mockProvider('openai', false)],
      env
    )
    expect(router.availableProviders()).toEqual(['anthropic'])
  })
})
