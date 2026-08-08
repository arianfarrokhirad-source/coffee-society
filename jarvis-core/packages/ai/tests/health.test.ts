import { describe, expect, it } from 'vitest'
import {
  checkAllProviders,
  checkProviderHealth,
  classifyProbeStatus,
  createHealthRegistry,
} from '../src/health'
import type { AIProvider, AIRequest, AIResponse, ProviderProbeResult } from '../src/types'

// The bug these exist to prevent: treating "a key is present" as "the
// provider works". Those are different facts and only the second one
// predicts that a request will succeed.

function provider(
  name: 'anthropic' | 'openai' | 'gemini',
  opts: {
    configured?: boolean
    probe?: (signal: AbortSignal) => Promise<ProviderProbeResult>
  } = {}
): AIProvider {
  const base: AIProvider = {
    name,
    isConfigured: () => opts.configured ?? true,
    async complete(request: AIRequest): Promise<AIResponse> {
      return {
        text: '',
        model: request.model,
        provider: name,
        usage: null,
        latencyMs: 0,
      }
    },
  }
  return opts.probe ? { ...base, probe: opts.probe } : base
}

describe('configured, reachable and healthy are three different facts', () => {
  it('reports unconfigured without touching the network', async () => {
    let called = false
    const health = await checkProviderHealth(
      provider('gemini', {
        configured: false,
        probe: async () => {
          called = true
          return { httpStatus: 200 }
        },
      })
    )
    expect(health.status).toBe('unconfigured')
    expect(health.configured).toBe(false)
    expect(health.reachable).toBe(false)
    expect(health.healthy).toBe(false)
    expect(called).toBe(false)
  })

  it('reports unknown — never healthy — when a provider has no probe', async () => {
    const health = await checkProviderHealth(provider('openai'))
    expect(health.status).toBe('unknown')
    expect(health.configured).toBe(true)
    expect(health.healthy).toBe(false)
    expect(health.reason).toBe('probe_not_implemented')
  })

  it('separates a bad credential from an outage', async () => {
    const unauthorized = await checkProviderHealth(
      provider('gemini', { probe: async () => ({ httpStatus: 401 }) })
    )
    expect(unauthorized.status).toBe('unauthorized')
    expect(unauthorized.reachable).toBe(true)
    expect(unauthorized.healthy).toBe(false)

    const down = await checkProviderHealth(
      provider('gemini', { probe: async () => ({ httpStatus: null, transportError: 'ENOTFOUND' }) })
    )
    expect(down.status).toBe('unreachable')
    expect(down.reachable).toBe(false)
  })

  it('treats rate limiting as reachable and authorized but not healthy', async () => {
    const health = await checkProviderHealth(
      provider('gemini', { probe: async () => ({ httpStatus: 429 }) })
    )
    expect(health.status).toBe('rate_limited')
    expect(health.reachable).toBe(true)
    expect(health.healthy).toBe(false)
  })

  it('reports healthy only on a success status', async () => {
    const health = await checkProviderHealth(
      provider('anthropic', { probe: async () => ({ httpStatus: 200 }) })
    )
    expect(health.status).toBe('healthy')
    expect(health.healthy).toBe(true)
    expect(health.httpStatus).toBe(200)
    expect(Date.parse(health.checkedAt)).not.toBeNaN()
  })
})

describe('status classification', () => {
  it.each([
    [200, 'healthy'],
    [204, 'healthy'],
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [429, 'rate_limited'],
    [500, 'degraded'],
    [503, 'degraded'],
    [404, 'degraded'],
  ])('maps HTTP %i to %s', (status, expected) => {
    expect(classifyProbeStatus(status).status).toBe(expected)
  })

  it('blames our own probe, not the provider, for an unexpected 4xx', () => {
    expect(classifyProbeStatus(404).reason).toBe('unexpected_probe_response')
  })
})

describe('a probe can never hang the caller', () => {
  it('aborts and reports timeout when the provider does not answer', async () => {
    const health = await checkProviderHealth(
      provider('gemini', {
        probe: (signal) =>
          new Promise((resolve, reject) => {
            // Never resolves on its own; only the abort ends it.
            signal.addEventListener('abort', () => reject(new Error('aborted')))
          }),
      }),
      { timeoutMs: 20 }
    )
    expect(health.status).toBe('unreachable')
    expect(health.reason).toBe('timeout')
  })

  it('survives a probe that throws synchronously', async () => {
    const health = await checkProviderHealth(
      provider('openai', {
        probe: async () => {
          throw new Error('boom')
        },
      })
    )
    expect(health.status).toBe('unreachable')
    expect(health.reason).toBe('probe_threw')
  })
})

describe('nothing sensitive reaches a health record', () => {
  it('never carries a provider response body or a credential', async () => {
    const health = await checkProviderHealth(
      provider('gemini', {
        probe: async () => ({
          httpStatus: 401,
          transportError: 'key sk-secret-123 rejected at db.internal:5432',
        }),
      })
    )
    const serialized = JSON.stringify(health)
    expect(serialized).not.toContain('sk-secret-123')
    expect(serialized).not.toContain('db.internal')
    // reason comes from a closed set, not from provider text.
    expect(health.reason).toBe('credential_rejected')
  })
})

describe('one provider failing never affects another', () => {
  it('returns a verdict for every provider even when one is down', async () => {
    const results = await checkAllProviders([
      provider('anthropic', { probe: async () => ({ httpStatus: 200 }) }),
      provider('openai', {
        probe: async () => {
          throw new Error('network down')
        },
      }),
      provider('gemini', { configured: false }),
    ])

    expect(results.map((r) => r.provider)).toEqual(['anthropic', 'openai', 'gemini'])
    expect(results.map((r) => r.status)).toEqual(['healthy', 'unreachable', 'unconfigured'])
  })

  it('does not reject when every provider is broken', async () => {
    const results = await checkAllProviders([
      provider('anthropic', {
        probe: async () => {
          throw new Error('x')
        },
      }),
      provider('openai', {
        probe: async () => {
          throw new Error('y')
        },
      }),
    ])
    expect(results.every((r) => r.healthy === false)).toBe(true)
  })
})

describe('health registry', () => {
  it('records the latest state per provider and lists healthy ones', async () => {
    const registry = createHealthRegistry()
    registry.set(
      await checkProviderHealth(provider('anthropic', { probe: async () => ({ httpStatus: 200 }) }))
    )
    registry.set(
      await checkProviderHealth(provider('openai', { probe: async () => ({ httpStatus: 500 }) }))
    )

    expect(registry.healthyProviders()).toEqual(['anthropic'])
    expect(registry.get('openai')?.status).toBe('degraded')
    expect(registry.all().length).toBe(2)

    // Re-checking replaces rather than appends.
    registry.set(
      await checkProviderHealth(provider('openai', { probe: async () => ({ httpStatus: 200 }) }))
    )
    expect(registry.all().length).toBe(2)
    expect(registry.healthyProviders().sort()).toEqual(['anthropic', 'openai'])
  })
})
