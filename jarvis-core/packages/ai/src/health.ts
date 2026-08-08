import type { AIProviderName } from '@jarvis/shared'
import type { AIProvider, ProviderHealth, ProviderHealthStatus } from './types'

// ---------------------------------------------------------------------
// Provider health.
//
// `isConfigured()` answers "is a key present". That is not the same
// question as "will a request succeed", and treating them as one is how
// a deploy passes its checks and then fails on first use.
//
// Three separable facts, reported separately:
//   configured — credential present, no network involved
//   reachable  — some HTTP response came back
//   healthy    — the provider accepted the credential and answered
//
// Rules this module enforces:
//   * strict timeout on every probe — an unreachable provider must not
//     hang the caller, which is the failure that turns one bad provider
//     into a stalled request;
//   * one provider's failure never affects another (allSettled, never
//     reject);
//   * no credential and no provider response body ever reaches the
//     result. `reason` is a fixed token from a closed set.
// ---------------------------------------------------------------------

export const DEFAULT_PROBE_TIMEOUT_MS = 5_000

function record(
  provider: AIProviderName,
  status: ProviderHealthStatus,
  fields: { httpStatus?: number | null; latencyMs?: number; reason: string }
): ProviderHealth {
  return {
    provider,
    status,
    configured: status !== 'unconfigured',
    reachable: status !== 'unconfigured' && status !== 'unreachable' && status !== 'unknown',
    healthy: status === 'healthy',
    httpStatus: fields.httpStatus ?? null,
    latencyMs: fields.latencyMs ?? 0,
    checkedAt: new Date().toISOString(),
    reason: fields.reason,
  }
}

/** Maps an observed HTTP status onto a health verdict. */
export function classifyProbeStatus(httpStatus: number): {
  status: ProviderHealthStatus
  reason: string
} {
  if (httpStatus === 401 || httpStatus === 403) {
    return { status: 'unauthorized', reason: 'credential_rejected' }
  }
  if (httpStatus === 429) return { status: 'rate_limited', reason: 'rate_limited' }
  if (httpStatus >= 500) return { status: 'degraded', reason: 'provider_error' }
  if (httpStatus >= 200 && httpStatus < 300) return { status: 'healthy', reason: 'ok' }
  // Any other 4xx means we reached an authorized-looking endpoint but the
  // probe itself was wrong. That is our bug, not an outage — say so
  // rather than reporting the provider as broken.
  return { status: 'degraded', reason: 'unexpected_probe_response' }
}

export async function checkProviderHealth(
  provider: AIProvider,
  options?: { timeoutMs?: number }
): Promise<ProviderHealth> {
  if (!provider.isConfigured()) {
    return record(provider.name, 'unconfigured', { reason: 'no_credential' })
  }
  if (!provider.probe) {
    // Honest gap rather than an optimistic guess: we know the key exists
    // and nothing more.
    return record(provider.name, 'unknown', { reason: 'probe_not_implemented' })
  }

  const timeoutMs = options?.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const started = Date.now()

  try {
    const result = await provider.probe(controller.signal)
    const latencyMs = Date.now() - started

    if (result.httpStatus == null) {
      return record(provider.name, 'unreachable', {
        latencyMs,
        // transportError may carry a hostname; it is not surfaced.
        reason: controller.signal.aborted ? 'timeout' : 'transport_failure',
      })
    }
    const { status, reason } = classifyProbeStatus(result.httpStatus)
    return record(provider.name, status, { httpStatus: result.httpStatus, latencyMs, reason })
  } catch {
    // A probe that throws is indistinguishable from one that could not
    // connect, and either way the provider is not usable right now.
    return record(provider.name, 'unreachable', {
      latencyMs: Date.now() - started,
      reason: controller.signal.aborted ? 'timeout' : 'probe_threw',
    })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Probes every provider concurrently. Never rejects: one provider being
 * down must not deny the caller a verdict on the others.
 */
export async function checkAllProviders(
  providers: AIProvider[],
  options?: { timeoutMs?: number }
): Promise<ProviderHealth[]> {
  const settled = await Promise.allSettled(providers.map((p) => checkProviderHealth(p, options)))
  return settled.map((outcome, i) => {
    if (outcome.status === 'fulfilled') return outcome.value
    // checkProviderHealth is written not to reject; this is belt and
    // braces so a future change cannot turn one bad provider into a
    // thrown health check.
    const name = providers[i]?.name ?? 'anthropic'
    return record(name, 'unknown', { reason: 'health_check_failed' })
  })
}

/**
 * Last-known health per provider.
 *
 * Deliberately in-memory and therefore per-instance. That is acceptable
 * here and would not be for a rate limiter: health is observability, and
 * a stale reading from another serverless instance is worse than no
 * reading. Anything needing cross-instance truth must probe or persist.
 */
export interface HealthRegistry {
  set(health: ProviderHealth): void
  get(provider: AIProviderName): ProviderHealth | undefined
  all(): ProviderHealth[]
  /** Providers currently believed healthy, for router preference. */
  healthyProviders(): AIProviderName[]
}

export function createHealthRegistry(): HealthRegistry {
  const state = new Map<AIProviderName, ProviderHealth>()
  return {
    set: (health) => void state.set(health.provider, health),
    get: (provider) => state.get(provider),
    all: () => [...state.values()],
    healthyProviders: () => [...state.values()].filter((h) => h.healthy).map((h) => h.provider),
  }
}
