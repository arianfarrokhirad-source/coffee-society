import { AIProviderError } from './types'

// ---------------------------------------------------------------------
// Retry policy.
//
// Two rules carry almost all of the value, and both are about NOT
// retrying:
//
//   1. Retry only transient failures. A 401 will fail identically every
//      time; retrying it converts a clear error into a slow one and
//      hides the real cause. Deterministic 4xx is never retried.
//
//   2. Jitter is mandatory. Without it, N callers that fail together
//      wait the same interval and retry together, re-colliding on every
//      round — a retry storm that turns one blip into sustained load.
//      Full jitter (random over the whole window) spreads them out.
//
// Two bounds prevent the other failure mode, where retrying is worse
// than failing: a maximum attempt count, and a total time budget that no
// sequence of backoffs may exceed.
// ---------------------------------------------------------------------

export interface RetryPolicy {
  /** Total tries including the first. 1 disables retrying. */
  maxAttempts?: number
  /** Base for the exponential curve. */
  initialDelayMs?: number
  /** Ceiling for a single wait, before jitter. */
  maxDelayMs?: number
  /** Hard budget for the whole sequence, waits included. */
  totalTimeoutMs?: number
  /** Injectable for deterministic tests. */
  random?: () => number
  /** Injectable for deterministic tests. */
  sleep?: (ms: number) => Promise<void>
  /** Observability hook; never throws into the retry loop. */
  onRetry?: (info: { attempt: number; delayMs: number; reason: RetryReason }) => void
}

export type RetryReason = 'rate_limited' | 'provider_error' | 'transport_failure' | 'timeout'

export interface RetryOutcome<T> {
  ok: boolean
  value?: T
  error?: unknown
  /** Total tries made, always ≥ 1. */
  attempts: number
  /** attempts − 1. This is what cost tracking records. */
  retries: number
  /** Sum of the waits actually performed. */
  totalDelayMs: number
}

export const DEFAULT_RETRY_POLICY = {
  maxAttempts: 3,
  initialDelayMs: 250,
  maxDelayMs: 8_000,
  totalTimeoutMs: 30_000,
} as const

/**
 * Whether a failure is worth trying again, and why.
 *
 * Null means "do not retry". The default for anything unrecognised is
 * null — fail-closed, because retrying an unknown error risks amplifying
 * a deterministic failure into load.
 */
export function classifyRetryable(error: unknown): RetryReason | null {
  if (error instanceof AIProviderError) {
    // A precondition failure we raised ourselves (missing credential)
    // has no status and will never succeed on a second try.
    if (error.status == null) return null
    if (error.status === 429) return 'rate_limited'
    if (error.status >= 500) return 'provider_error'
    // Every other 4xx is deterministic: bad request, bad key, forbidden,
    // not found. Retrying is strictly harmful.
    return null
  }
  // fetch() rejects with TypeError on DNS/TLS/connection failure, and
  // with an AbortError when a timeout fires. Both are transient.
  if (error instanceof Error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') return 'timeout'
    if (error instanceof TypeError) return 'transport_failure'
  }
  return null
}

/**
 * Full jitter: a uniform random wait over [0, window], where window
 * grows exponentially and is capped.
 *
 * Full jitter is chosen over "exponential + small jitter" because it
 * de-correlates callers most aggressively, which is the entire point
 * when many workers fail at once — the bulk-extraction case.
 */
export function computeBackoffDelay(
  attempt: number,
  policy: Pick<RetryPolicy, 'initialDelayMs' | 'maxDelayMs' | 'random'> = {}
): number {
  const initial = policy.initialDelayMs ?? DEFAULT_RETRY_POLICY.initialDelayMs
  const max = policy.maxDelayMs ?? DEFAULT_RETRY_POLICY.maxDelayMs
  const random = policy.random ?? Math.random
  const window = Math.min(max, initial * 2 ** Math.max(0, attempt - 1))
  return Math.floor(random() * window)
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Runs `fn`, retrying only transient failures.
 *
 * Returns an outcome rather than throwing so callers can record how many
 * attempts a result cost — retries are a cost signal, and a thrown error
 * discards that count.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  policy: RetryPolicy = {}
): Promise<RetryOutcome<T>> {
  const maxAttempts = Math.max(1, policy.maxAttempts ?? DEFAULT_RETRY_POLICY.maxAttempts)
  const totalTimeoutMs = policy.totalTimeoutMs ?? DEFAULT_RETRY_POLICY.totalTimeoutMs
  const sleep = policy.sleep ?? defaultSleep
  const deadline = Date.now() + totalTimeoutMs

  let attempts = 0
  let totalDelayMs = 0
  let lastError: unknown

  for (;;) {
    attempts += 1
    try {
      const value = await fn(attempts)
      return { ok: true, value, attempts, retries: attempts - 1, totalDelayMs }
    } catch (error) {
      lastError = error
      const reason = classifyRetryable(error)

      // Stop: deterministic failure, or budget exhausted.
      if (reason === null || attempts >= maxAttempts) break

      // The provider's own Retry-After beats our curve — it knows its
      // quota window. Still capped, so a hostile or mistaken header
      // cannot park us indefinitely.
      const suggested =
        error instanceof AIProviderError && error.retryAfterMs != null ? error.retryAfterMs : null
      const backoff = computeBackoffDelay(attempts, policy)
      const delayMs = Math.min(
        suggested ?? backoff,
        policy.maxDelayMs ?? DEFAULT_RETRY_POLICY.maxDelayMs
      )

      // Never sleep past the total budget: waiting out the deadline and
      // then failing is worse than failing now.
      if (Date.now() + delayMs >= deadline) break

      policy.onRetry?.({ attempt: attempts, delayMs, reason })
      await sleep(delayMs)
      totalDelayMs += delayMs
    }
  }

  return { ok: false, error: lastError, attempts, retries: attempts - 1, totalDelayMs }
}
