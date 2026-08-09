import type { AIProviderName } from '@jarvis/shared'
import type { AIUsage } from './types'

// ---------------------------------------------------------------------
// Pricing.
//
// No rate is hard-coded anywhere in this file, deliberately. Provider
// prices change, differ by tier and region, and a stale number compiled
// into the binary is worse than no number: it produces confident,
// wrong cost reports that nobody re-checks.
//
// So pricing arrives as versioned configuration with provenance, and an
// unpriced model reports cost `null` — "unknown" — never 0. Zero is a
// measurement; null is an admission. Conflating them is how a budget
// silently stops enforcing anything.
// ---------------------------------------------------------------------

/** Rate for one model, in currency units per million tokens. */
export interface ModelPrice {
  inputPerMillion: number
  outputPerMillion: number
}

export interface PricingTable {
  /**
   * Version of this table — a date or release tag. Recorded on every
   * usage row so a cost figure can always be traced to the rates that
   * produced it.
   */
  version: string
  /** ISO 4217 code. Costs are meaningless without it. */
  currency: string
  /**
   * Where these rates came from: a URL or document reference. Required,
   * because an unattributed rate cannot be audited or refreshed.
   */
  source: string
  /** Keyed `provider:model`, e.g. `gemini:gemini-2.5-flash`. */
  models: Record<string, ModelPrice>
}

export type CostReason = 'ok' | 'no_pricing_table' | 'model_not_priced' | 'no_usage_reported'

export interface CostEstimate {
  /** Null whenever the cost is unknown. Never a fabricated 0. */
  estimatedCost: number | null
  currency: string | null
  pricingVersion: string | null
  reason: CostReason
}

export function priceKey(provider: AIProviderName, model: string): string {
  return `${provider}:${model}`
}

/** Shallow validation — a malformed table must not silently price at 0. */
export function isPricingTable(value: unknown): value is PricingTable {
  if (typeof value !== 'object' || value === null) return false
  const table = value as Partial<PricingTable>
  if (typeof table.version !== 'string' || table.version.length === 0) return false
  if (typeof table.currency !== 'string' || table.currency.length === 0) return false
  if (typeof table.source !== 'string' || table.source.length === 0) return false
  if (typeof table.models !== 'object' || table.models === null) return false
  return Object.values(table.models).every(
    (price) =>
      typeof price === 'object' &&
      price !== null &&
      typeof (price as ModelPrice).inputPerMillion === 'number' &&
      typeof (price as ModelPrice).outputPerMillion === 'number' &&
      (price as ModelPrice).inputPerMillion >= 0 &&
      (price as ModelPrice).outputPerMillion >= 0
  )
}

/**
 * Loads the pricing table from JARVIS_AI_PRICING (inline JSON).
 *
 * Returns null when unset or invalid — never a partial table. A caller
 * that gets null knows cost is unmeasurable, which is a fact it can act
 * on; a half-parsed table is one it cannot.
 */
export function loadPricingTable(raw?: string | null): PricingTable | null {
  const source = raw ?? process.env.JARVIS_AI_PRICING
  if (!source) return null
  try {
    const parsed: unknown = JSON.parse(source)
    return isPricingTable(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Computes cost from reported usage.
 *
 * Every "cannot compute" path is distinguishable, because the three
 * reasons need different fixes: configure a table, add a model to it, or
 * find out why the provider reported no usage.
 */
export function estimateCost(
  provider: AIProviderName,
  model: string,
  usage: AIUsage | null,
  table: PricingTable | null
): CostEstimate {
  if (!table) {
    return {
      estimatedCost: null,
      currency: null,
      pricingVersion: null,
      reason: 'no_pricing_table',
    }
  }
  if (!usage) {
    return {
      estimatedCost: null,
      currency: table.currency,
      pricingVersion: table.version,
      reason: 'no_usage_reported',
    }
  }
  const price = table.models[priceKey(provider, model)]
  if (!price) {
    return {
      estimatedCost: null,
      currency: table.currency,
      pricingVersion: table.version,
      reason: 'model_not_priced',
    }
  }
  const cost =
    (usage.inputTokens / 1_000_000) * price.inputPerMillion +
    (usage.outputTokens / 1_000_000) * price.outputPerMillion
  return {
    estimatedCost: cost,
    currency: table.currency,
    pricingVersion: table.version,
    reason: 'ok',
  }
}
