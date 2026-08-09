import { describe, expect, it } from 'vitest'
import { estimateCost, isPricingTable, loadPricingTable, type PricingTable } from '../src/pricing'
import { createRouter, type RouterEnv } from '../src/router'
import { createBudgetedRouter, createUsageTracker } from '../src/usage'
import { AIProviderError, type AIProvider, type AIRequest, type AIResponse } from '../src/types'

// Two properties matter most here and both are about honesty:
//   * an unknown cost is null, never 0 — 0 is a measurement, null is an
//     admission, and conflating them makes a budget stop enforcing;
//   * a cost cap that cannot be measured DENIES rather than allows.

const TABLE: PricingTable = {
  version: '2026-08-01',
  currency: 'USD',
  source: 'operator-supplied config, not compiled rates',
  models: {
    'gemini:gemini-flash': { inputPerMillion: 10, outputPerMillion: 20 },
  },
}

function provider(
  name: 'anthropic' | 'openai' | 'gemini',
  behavior: 'ok' | 'fail' = 'ok',
  usage: { inputTokens: number; outputTokens: number } | null = {
    inputTokens: 1_000_000,
    outputTokens: 500_000,
  }
): AIProvider {
  return {
    name,
    isConfigured: () => true,
    async complete(request: AIRequest): Promise<AIResponse> {
      if (behavior === 'fail') throw new AIProviderError(name, 'bad request', 400)
      return { text: 'x', model: request.model, provider: name, usage, latencyMs: 12 }
    },
  }
}

const env: RouterEnv = { providerModels: { gemini: { default: 'gemini-flash' } } }

describe('pricing is configuration, never compiled-in rates', () => {
  it('reports unknown cost — not zero — with no pricing table', () => {
    const estimate = estimateCost(
      'gemini',
      'gemini-flash',
      { inputTokens: 100, outputTokens: 100 },
      null
    )
    expect(estimate.estimatedCost).toBeNull()
    expect(estimate.reason).toBe('no_pricing_table')
  })

  it('distinguishes an unpriced model from a missing table', () => {
    const estimate = estimateCost(
      'openai',
      'some-new-model',
      { inputTokens: 1, outputTokens: 1 },
      TABLE
    )
    expect(estimate.estimatedCost).toBeNull()
    expect(estimate.reason).toBe('model_not_priced')
    // Version still reported, so the gap is traceable to a table.
    expect(estimate.pricingVersion).toBe('2026-08-01')
  })

  it('distinguishes a provider reporting no usage', () => {
    const estimate = estimateCost('gemini', 'gemini-flash', null, TABLE)
    expect(estimate.estimatedCost).toBeNull()
    expect(estimate.reason).toBe('no_usage_reported')
  })

  it('computes cost per million tokens and carries provenance', () => {
    const estimate = estimateCost(
      'gemini',
      'gemini-flash',
      { inputTokens: 2_000_000, outputTokens: 1_000_000 },
      TABLE
    )
    // 2M input at 10/M = 20, 1M output at 20/M = 20.
    expect(estimate.estimatedCost).toBeCloseTo(40)
    expect(estimate.currency).toBe('USD')
    expect(estimate.pricingVersion).toBe('2026-08-01')
    expect(estimate.reason).toBe('ok')
  })

  it('rejects a malformed table rather than pricing at zero', () => {
    expect(isPricingTable({ version: '1', currency: 'USD', source: 's', models: {} })).toBe(true)
    expect(isPricingTable({ version: '1', currency: 'USD', models: {} })).toBe(false)
    expect(isPricingTable({ version: '', currency: 'USD', source: 's', models: {} })).toBe(false)
    expect(
      isPricingTable({
        version: '1',
        currency: 'USD',
        source: 's',
        models: { 'a:b': { inputPerMillion: -1, outputPerMillion: 1 } },
      })
    ).toBe(false)
  })

  it('returns null for unparseable or absent configuration', () => {
    expect(loadPricingTable('not json')).toBeNull()
    expect(loadPricingTable('')).toBeNull()
    expect(loadPricingTable(JSON.stringify({ nope: true }))).toBeNull()
    expect(loadPricingTable(JSON.stringify(TABLE))?.version).toBe('2026-08-01')
  })
})

describe('usage records carry cost signals and no content', () => {
  it('records provider, model, route, tokens, latency and retries', async () => {
    const tracker = createUsageTracker({ pricing: TABLE })
    const router = createBudgetedRouter(createRouter([provider('gemini')], env), {
      tracker,
      pricing: TABLE,
    })

    const result = await router.complete('extraction', {
      messages: [{ role: 'user', content: 'a very secret business prompt' }],
    })
    expect(result.ok).toBe(true)

    const [record] = tracker.records()
    expect(record?.provider).toBe('gemini')
    expect(record?.model).toBe('gemini-flash')
    expect(record?.route).toBe('extraction')
    expect(record?.inputTokens).toBe(1_000_000)
    expect(record?.outputTokens).toBe(500_000)
    expect(record?.latencyMs).toBe(12)
    expect(record?.retries).toBe(0)
    expect(record?.success).toBe(true)
    expect(record?.estimatedCost).toBeCloseTo(20)
    expect(Date.parse(record?.at ?? '')).not.toBeNaN()
  })

  it('never stores prompt or completion text', async () => {
    const tracker = createUsageTracker({ pricing: TABLE })
    const router = createBudgetedRouter(createRouter([provider('gemini')], env), {
      tracker,
      pricing: TABLE,
    })
    await router.complete('extraction', {
      messages: [{ role: 'user', content: 'patient name Jane Doe, phone +447700900123' }],
    })

    const serialized = JSON.stringify(tracker.records())
    expect(serialized).not.toContain('Jane Doe')
    expect(serialized).not.toContain('447700900123')
  })

  it('records a failed route without inventing a provider', async () => {
    const tracker = createUsageTracker({ pricing: TABLE })
    const router = createBudgetedRouter(createRouter([provider('gemini', 'fail')], env), {
      tracker,
      pricing: TABLE,
    })

    const result = await router.complete('extraction', {
      messages: [{ role: 'user', content: 'x' }],
    })
    expect(result.ok).toBe(false)

    const [record] = tracker.records()
    expect(record?.success).toBe(false)
    expect(record?.provider).toBeNull()
    expect(record?.model).toBeNull()
    expect(record?.estimatedCost).toBeNull()
  })

  it('totals known costs and flags that some usage was unpriced', async () => {
    const tracker = createUsageTracker({ pricing: TABLE })
    // openai has no entry in TABLE.models, so its cost is unknown.
    const router = createBudgetedRouter(
      createRouter([provider('openai')], { executiveModel: 'gpt-x' }),
      { tracker, pricing: TABLE }
    )
    await router.complete('executive', { messages: [{ role: 'user', content: 'x' }] })

    const totals = tracker.totals()
    expect(totals.requests).toBe(1)
    expect(totals.totalTokens).toBe(1_500_000)
    expect(totals.cost).toBeNull()
    expect(totals.hasUnpricedUsage).toBe(true)
  })
})

describe('hard budgets fail closed', () => {
  it('refuses a request once the request cap is reached', async () => {
    const tracker = createUsageTracker({ pricing: TABLE, limits: { maxRequests: 1 } })
    const router = createBudgetedRouter(createRouter([provider('gemini')], env), {
      tracker,
      pricing: TABLE,
    })

    expect((await router.complete('extraction', { messages: [] })).ok).toBe(true)
    const second = await router.complete('extraction', { messages: [] })
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error).toContain('requests_exceeded')
  })

  it('refuses once the token cap is reached', async () => {
    const tracker = createUsageTracker({ pricing: TABLE, limits: { maxTokens: 1_000_000 } })
    const router = createBudgetedRouter(createRouter([provider('gemini')], env), {
      tracker,
      pricing: TABLE,
    })

    expect((await router.complete('extraction', { messages: [] })).ok).toBe(true)
    const second = await router.complete('extraction', { messages: [] })
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error).toContain('tokens_exceeded')
  })

  it('refuses once the cost cap is reached', async () => {
    const tracker = createUsageTracker({ pricing: TABLE, limits: { maxCost: 15 } })
    const router = createBudgetedRouter(createRouter([provider('gemini')], env), {
      tracker,
      pricing: TABLE,
    })

    // First call costs 20, which is over the 15 cap — so the SECOND is denied.
    expect((await router.complete('extraction', { messages: [] })).ok).toBe(true)
    const second = await router.complete('extraction', { messages: [] })
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error).toContain('cost_exceeded')
  })

  it('denies from the very first request when a cost cap is set but pricing is absent', async () => {
    // The rule that matters: being unable to measure spend is not
    // permission to spend. Without this the operator has a cap that
    // silently enforces nothing.
    const tracker = createUsageTracker({ limits: { maxCost: 100 } })
    const router = createBudgetedRouter(createRouter([provider('gemini')], env), { tracker })

    const result = await router.complete('extraction', { messages: [] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('cost_unmeasurable')
    // Nothing was spent, so nothing was recorded.
    expect(tracker.records()).toEqual([])
  })

  it('denies once a cost-capped run contains unpriced usage', async () => {
    const tracker = createUsageTracker({ pricing: TABLE, limits: { maxCost: 1_000_000 } })
    const router = createBudgetedRouter(
      createRouter([provider('openai')], { executiveModel: 'gpt-x' }),
      { tracker, pricing: TABLE }
    )

    // First succeeds; its cost is unknown because gpt-x is unpriced.
    expect((await router.complete('executive', { messages: [] })).ok).toBe(true)
    const second = await router.complete('executive', { messages: [] })
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error).toContain('cost_unmeasurable')
  })

  it('imposes no limits when none are configured', async () => {
    const tracker = createUsageTracker({ pricing: TABLE })
    const router = createBudgetedRouter(createRouter([provider('gemini')], env), {
      tracker,
      pricing: TABLE,
    })
    for (let i = 0; i < 5; i += 1) {
      expect((await router.complete('extraction', { messages: [] })).ok).toBe(true)
    }
    expect(tracker.totals().requests).toBe(5)
  })
})

describe('the decorator does not change routing behaviour', () => {
  it('delegates resolveRoute and availableProviders unchanged', () => {
    const inner = createRouter([provider('gemini')], env)
    const wrapped = createBudgetedRouter(inner, { tracker: createUsageTracker() })

    expect(wrapped.availableProviders()).toEqual(inner.availableProviders())
    const a = wrapped.resolveRoute('extraction')
    const b = inner.resolveRoute('extraction')
    expect(a.ok && a.value.provider).toBe(b.ok && b.value.provider)
  })
})
