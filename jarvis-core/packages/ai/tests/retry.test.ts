import { describe, expect, it } from 'vitest'
import {
  classifyRetryable,
  computeBackoffDelay,
  DEFAULT_RETRY_POLICY,
  withRetry,
} from '../src/retry'
import { AIProviderError } from '../src/types'

// A retry layer earns its place by what it refuses to retry. These pin
// that: deterministic failures must fail fast, and no failure mode may
// produce an unbounded or synchronised retry sequence.

/** Records waits without actually waiting, so tests stay fast. */
function fakeClock() {
  const waits: number[] = []
  return {
    waits,
    sleep: async (ms: number) => void waits.push(ms),
  }
}

describe('only transient failures are retried', () => {
  it.each([
    [429, 'rate_limited'],
    [500, 'provider_error'],
    [502, 'provider_error'],
    [503, 'provider_error'],
  ])('retries HTTP %i as %s', (status, reason) => {
    expect(classifyRetryable(new AIProviderError('gemini', 'x', status))).toBe(reason)
  })

  it.each([400, 401, 403, 404, 409, 422])('never retries deterministic HTTP %i', (status) => {
    expect(classifyRetryable(new AIProviderError('gemini', 'x', status))).toBeNull()
  })

  it('never retries our own precondition failure', () => {
    // Missing credential: status is null and a second attempt cannot help.
    expect(
      classifyRetryable(new AIProviderError('gemini', 'GEMINI_API_KEY is not configured'))
    ).toBe(null)
  })

  it('retries transport failures and timeouts', () => {
    expect(classifyRetryable(new TypeError('fetch failed'))).toBe('transport_failure')
    const aborted = new Error('aborted')
    aborted.name = 'AbortError'
    expect(classifyRetryable(aborted)).toBe('timeout')
  })

  it('fails closed on anything unrecognised', () => {
    expect(classifyRetryable(new Error('who knows'))).toBeNull()
    expect(classifyRetryable('a string')).toBeNull()
    expect(classifyRetryable(null)).toBeNull()
  })
})

describe('a deterministic failure costs exactly one attempt', () => {
  it('does not retry a 401', async () => {
    const clock = fakeClock()
    let calls = 0
    const outcome = await withRetry(
      async () => {
        calls += 1
        throw new AIProviderError('openai', 'unauthorized', 401)
      },
      { sleep: clock.sleep }
    )

    expect(outcome.ok).toBe(false)
    expect(calls).toBe(1)
    expect(outcome.retries).toBe(0)
    expect(clock.waits).toEqual([])
  })
})

describe('bounded attempts — no retry storms', () => {
  it('stops at maxAttempts and reports the count', async () => {
    const clock = fakeClock()
    let calls = 0
    const outcome = await withRetry(
      async () => {
        calls += 1
        throw new AIProviderError('gemini', 'busy', 503)
      },
      { maxAttempts: 4, sleep: clock.sleep, random: () => 1 }
    )

    expect(outcome.ok).toBe(false)
    expect(calls).toBe(4)
    expect(outcome.attempts).toBe(4)
    expect(outcome.retries).toBe(3)
    expect(clock.waits.length).toBe(3)
  })

  it('maxAttempts of 1 disables retrying entirely', async () => {
    let calls = 0
    const outcome = await withRetry(
      async () => {
        calls += 1
        throw new AIProviderError('gemini', 'busy', 503)
      },
      { maxAttempts: 1 }
    )
    expect(calls).toBe(1)
    expect(outcome.retries).toBe(0)
  })

  it('never sleeps past the total time budget', async () => {
    const clock = fakeClock()
    const outcome = await withRetry(
      async () => {
        throw new AIProviderError('gemini', 'busy', 503)
      },
      {
        maxAttempts: 10,
        // Each wait would be 5s at full jitter; the 1.2s budget permits none.
        initialDelayMs: 5_000,
        totalTimeoutMs: 1_200,
        random: () => 1,
        sleep: clock.sleep,
      }
    )
    expect(outcome.ok).toBe(false)
    expect(clock.waits).toEqual([])
    expect(outcome.attempts).toBe(1)
  })

  it('succeeds on a later attempt and reports the retries it cost', async () => {
    const clock = fakeClock()
    let calls = 0
    const outcome = await withRetry(
      async () => {
        calls += 1
        if (calls < 3) throw new AIProviderError('gemini', 'busy', 500)
        return 'ok'
      },
      { sleep: clock.sleep, random: () => 0.5 }
    )

    expect(outcome.ok).toBe(true)
    expect(outcome.value).toBe('ok')
    expect(outcome.attempts).toBe(3)
    expect(outcome.retries).toBe(2)
    expect(outcome.totalDelayMs).toBe(clock.waits.reduce((a, b) => a + b, 0))
  })
})

describe('backoff is exponential, capped, and jittered', () => {
  it('grows exponentially from the initial delay', () => {
    const policy = { initialDelayMs: 100, maxDelayMs: 100_000, random: () => 1 }
    expect(computeBackoffDelay(1, policy)).toBe(100)
    expect(computeBackoffDelay(2, policy)).toBe(200)
    expect(computeBackoffDelay(3, policy)).toBe(400)
    expect(computeBackoffDelay(4, policy)).toBe(800)
  })

  it('respects the ceiling however many attempts have passed', () => {
    const policy = { initialDelayMs: 100, maxDelayMs: 500, random: () => 1 }
    expect(computeBackoffDelay(9, policy)).toBe(500)
    expect(computeBackoffDelay(30, policy)).toBe(500)
  })

  it('applies full jitter — the wait is a random point in the window, not the window', () => {
    const policy = { initialDelayMs: 1_000, maxDelayMs: 10_000 }
    const samples = new Set(
      Array.from({ length: 40 }, () => computeBackoffDelay(3, { ...policy, random: Math.random }))
    )
    // Unjittered backoff would yield one value 40 times, which is exactly
    // how independent callers stay synchronised and re-collide.
    expect(samples.size).toBeGreaterThan(5)
    for (const wait of samples) {
      expect(wait).toBeGreaterThanOrEqual(0)
      expect(wait).toBeLessThanOrEqual(4_000)
    }
  })

  it('cannot produce a negative or non-integer wait', () => {
    expect(computeBackoffDelay(1, { random: () => 0 })).toBe(0)
    expect(Number.isInteger(computeBackoffDelay(3, { random: () => 0.7777 }))).toBe(true)
  })
})

describe("the provider's Retry-After beats our own curve", () => {
  it('waits exactly as long as the provider asked', async () => {
    const clock = fakeClock()
    let calls = 0
    await withRetry(
      async () => {
        calls += 1
        if (calls === 1) throw new AIProviderError('gemini', 'slow down', 429, 1_500)
        return 'ok'
      },
      { sleep: clock.sleep, initialDelayMs: 10, random: () => 1 }
    )
    expect(clock.waits).toEqual([1_500])
  })

  it('still caps a hostile or mistaken Retry-After', async () => {
    const clock = fakeClock()
    let calls = 0
    await withRetry(
      async () => {
        calls += 1
        // Roughly 11 days — honouring this literally would park us forever.
        if (calls === 1) throw new AIProviderError('gemini', 'go away', 429, 999_999_999)
        return 'ok'
      },
      { sleep: clock.sleep, maxDelayMs: 2_000, totalTimeoutMs: 60_000 }
    )
    expect(clock.waits).toEqual([2_000])
  })
})

describe('observability', () => {
  it('reports every retry with its reason and delay', async () => {
    const seen: { attempt: number; delayMs: number; reason: string }[] = []
    const clock = fakeClock()
    await withRetry(
      async (attempt) => {
        if (attempt < 3) throw new AIProviderError('gemini', 'busy', 429)
        return 'ok'
      },
      { sleep: clock.sleep, random: () => 0.5, onRetry: (info) => seen.push(info) }
    )
    expect(seen.map((s) => s.attempt)).toEqual([1, 2])
    expect(seen.every((s) => s.reason === 'rate_limited')).toBe(true)
  })

  it('keeps sane defaults', () => {
    expect(DEFAULT_RETRY_POLICY.maxAttempts).toBe(3)
    expect(DEFAULT_RETRY_POLICY.totalTimeoutMs).toBeLessThanOrEqual(30_000)
  })
})
