import type { AIProviderName } from '@jarvis/shared'
import { err, ok, type Result } from '@jarvis/shared'
import { estimateCost, type CostReason, type PricingTable } from './pricing'
import type { AIRouter, CompleteResult } from './router'
import type { AIRequest, RouteKind } from './types'

// ---------------------------------------------------------------------
// Usage accounting and run budgets.
//
// One row per completed route, carrying what it cost and what it took.
// Deliberately excluded: prompt text and completion text. A token count
// is telemetry; a prompt may contain identity data or business content,
// and putting the two in the same record turns observability into a
// data-protection problem.
//
// The fail-closed rule that matters: if a COST budget is set but pricing
// is unknown, requests are DENIED. Being asked to enforce a spend cap
// while unable to measure spend is not permission to spend freely — it
// is a configuration error, and proceeding would give the operator a cap
// that silently enforces nothing.
// ---------------------------------------------------------------------

export interface UsageRecord {
  /**
   * Null only when no provider produced a result — a route that failed
   * everywhere has no winning provider, and naming one would be fiction.
   */
  provider: AIProviderName | null
  model: string | null
  route: RouteKind
  inputTokens: number | null
  outputTokens: number | null
  latencyMs: number
  /** Retries spent reaching this outcome. 0 on a first-attempt success. */
  retries: number
  estimatedCost: number | null
  currency: string | null
  pricingVersion: string | null
  costReason: CostReason
  success: boolean
  at: string
}

export interface BudgetLimits {
  /** Hard cap in the pricing table's currency. */
  maxCost?: number
  /** Hard cap on input + output tokens across the run. */
  maxTokens?: number
  /** Hard cap on completed route calls. */
  maxRequests?: number
}

export type BudgetDenialReason =
  'cost_exceeded' | 'tokens_exceeded' | 'requests_exceeded' | 'cost_unmeasurable'

export interface BudgetVerdict {
  allowed: boolean
  reason?: BudgetDenialReason
}

export interface UsageTotals {
  requests: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  /** Sum of known costs only. Null when nothing could be priced. */
  cost: number | null
  /** True when at least one record had an unknown cost. */
  hasUnpricedUsage: boolean
  retries: number
}

export interface UsageTracker {
  record(entry: UsageRecord): void
  records(): UsageRecord[]
  totals(): UsageTotals
  /** Checked before each request; fail-closed. */
  check(): BudgetVerdict
}

export function createUsageTracker(options?: {
  limits?: BudgetLimits
  pricing?: PricingTable | null
}): UsageTracker {
  const entries: UsageRecord[] = []
  const limits = options?.limits ?? {}
  const pricingAvailable = !!options?.pricing

  function totals(): UsageTotals {
    let inputTokens = 0
    let outputTokens = 0
    let cost = 0
    let priced = 0
    let retries = 0
    let unpriced = false

    for (const entry of entries) {
      inputTokens += entry.inputTokens ?? 0
      outputTokens += entry.outputTokens ?? 0
      retries += entry.retries
      if (entry.estimatedCost == null) unpriced = true
      else {
        cost += entry.estimatedCost
        priced += 1
      }
    }

    return {
      requests: entries.length,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      cost: priced > 0 ? cost : null,
      hasUnpricedUsage: unpriced,
      retries,
    }
  }

  return {
    record: (entry) => void entries.push(entry),
    records: () => [...entries],
    totals,
    check(): BudgetVerdict {
      // A cost cap we cannot measure must deny, not wave through.
      if (limits.maxCost != null && !pricingAvailable) {
        return { allowed: false, reason: 'cost_unmeasurable' }
      }

      const spent = totals()
      if (limits.maxRequests != null && spent.requests >= limits.maxRequests) {
        return { allowed: false, reason: 'requests_exceeded' }
      }
      if (limits.maxTokens != null && spent.totalTokens >= limits.maxTokens) {
        return { allowed: false, reason: 'tokens_exceeded' }
      }
      if (limits.maxCost != null) {
        // Unpriced usage inside a cost-capped run means the running total
        // understates reality. Refusing is the only honest response.
        if (spent.hasUnpricedUsage) return { allowed: false, reason: 'cost_unmeasurable' }
        if ((spent.cost ?? 0) >= limits.maxCost) {
          return { allowed: false, reason: 'cost_exceeded' }
        }
      }
      return { allowed: true }
    },
  }
}

/**
 * Wraps a router so every call is budget-checked before it happens and
 * recorded after it completes.
 *
 * A decorator rather than another parameter on createRouter: routing and
 * accounting are separate concerns, and keeping them separate means the
 * router stays testable without a tracker and the tracker without a
 * network.
 */
export function createBudgetedRouter(
  inner: AIRouter,
  options: { tracker: UsageTracker; pricing?: PricingTable | null }
): AIRouter {
  const { tracker } = options
  const pricing = options.pricing ?? null

  async function completeWithStats(
    kind: RouteKind,
    request: Omit<AIRequest, 'model'>
  ): Promise<Result<CompleteResult>> {
    const verdict = tracker.check()
    if (!verdict.allowed) {
      return err(`AI budget refused route '${kind}': ${verdict.reason}`)
    }

    const result = await inner.completeWithStats(kind, request)

    if (!result.ok) {
      // Failures cost money too — a 500 after two retries consumed
      // provider capacity even though no usage came back. Recording them
      // is what makes a spend spike explainable.
      tracker.record({
        provider: null,
        model: null,
        route: kind,
        inputTokens: null,
        outputTokens: null,
        latencyMs: 0,
        retries: 0,
        estimatedCost: null,
        currency: pricing?.currency ?? null,
        pricingVersion: pricing?.version ?? null,
        costReason: 'no_usage_reported',
        success: false,
        at: new Date().toISOString(),
      })
      return result
    }

    const { response, stats } = result.value
    const cost = estimateCost(response.provider, response.model, response.usage, pricing)

    tracker.record({
      provider: response.provider,
      model: response.model,
      route: kind,
      inputTokens: response.usage?.inputTokens ?? null,
      outputTokens: response.usage?.outputTokens ?? null,
      latencyMs: response.latencyMs,
      // Retries across every provider tried, not just the winner: the
      // failed attempts are part of what this result cost.
      retries: stats.reduce((sum, s) => sum + s.retries, 0),
      estimatedCost: cost.estimatedCost,
      currency: cost.currency,
      pricingVersion: cost.pricingVersion,
      costReason: cost.reason,
      success: true,
      at: new Date().toISOString(),
    })

    return ok(result.value)
  }

  return {
    resolveRoute: (kind) => inner.resolveRoute(kind),
    availableProviders: () => inner.availableProviders(),
    completeWithStats,
    async complete(kind, request) {
      const result = await completeWithStats(kind, request)
      return result.ok ? ok(result.value.response) : result
    },
  }
}
