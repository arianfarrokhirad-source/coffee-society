import { describe, expect, it, vi } from 'vitest'
import { err, ok } from '@jarvis/shared'
import { runBatch } from '../src/batch'
import { createUsageTracker } from '../src/usage'

// The batch engine is what turns this from a chat feature into
// infrastructure. The properties that matter are all about behaviour
// under partial failure and under a spend cap.

function items(count: number) {
  return Array.from({ length: count }, (_, i) => ({ id: `item-${i}`, input: i }))
}

describe('runBatch', () => {
  it('returns results in input order regardless of completion order', async () => {
    // Callers zip results back onto their own arrays by index. If
    // completion order leaked through, every slow item would silently
    // attach its output to the wrong source record.
    const report = await runBatch(
      items(6),
      async (input) => {
        await new Promise((resolve) => setTimeout(resolve, (6 - input) * 5))
        return ok(input * 10)
      },
      { concurrency: 6 }
    )

    expect(report.results.map((r) => r.index)).toEqual([0, 1, 2, 3, 4, 5])
    expect(report.results.map((r) => r.value)).toEqual([0, 10, 20, 30, 40, 50])
  })

  it('never exceeds the concurrency limit', async () => {
    let running = 0
    let peak = 0

    await runBatch(
      items(20),
      async (input) => {
        running += 1
        peak = Math.max(peak, running)
        await new Promise((resolve) => setTimeout(resolve, 5))
        running -= 1
        return ok(input)
      },
      { concurrency: 3 }
    )

    expect(peak).toBeLessThanOrEqual(3)
    expect(peak).toBe(3)
  })

  it('keeps all lanes busy rather than running in lockstep groups', async () => {
    // The convoy problem: chunked Promise.all would wait for the slow
    // item in each group of 2, taking ~3 slow waits. A worker pool
    // overlaps them.
    const durations = [50, 1, 1, 1, 1, 1]
    const started = Date.now()

    await runBatch(
      durations.map((ms, i) => ({ id: `d-${i}`, input: ms })),
      async (ms) => {
        await new Promise((resolve) => setTimeout(resolve, ms))
        return ok(ms)
      },
      { concurrency: 2 }
    )

    // Pool: the 50ms item occupies one lane while the other lane clears
    // the five short ones. Lockstep chunking would cost far more.
    expect(Date.now() - started).toBeLessThan(120)
  })

  it('records a failed item without failing the run', async () => {
    const report = await runBatch(items(5), async (input) =>
      input === 2 ? err('unparseable') : ok(input)
    )

    expect(report.succeeded).toBe(4)
    expect(report.failed).toBe(1)
    expect(report.stopReason).toBe('completed')
    expect(report.results[2]?.ok).toBe(false)
    expect(report.results[2]?.error).toBe('unparseable')
  })

  it('catches a worker that throws instead of returning a Result', async () => {
    // One badly behaved worker must not take the pool down.
    const report = await runBatch(items(4), async (input) => {
      if (input === 1) throw new Error('boom')
      return ok(input)
    })

    expect(report.succeeded).toBe(3)
    expect(report.results[1]?.error).toBe('boom')
  })

  it('survives a worker that throws a non-Error', async () => {
    const report = await runBatch(items(2), async (input) => {
      if (input === 0) throw 'a bare string'
      return ok(input)
    })
    expect(report.results[0]?.error).toBe('worker threw a non-Error')
  })

  it('stops when the budget denies, and reports what was skipped', async () => {
    // Out of money is not this item failing — it is the run being over.
    // Continuing would spend past a cap the operator set.
    const tracker = createUsageTracker({ limits: { maxRequests: 3 } })
    const worker = vi.fn(async (input: number) => {
      tracker.record({
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        route: 'extraction',
        inputTokens: 10,
        outputTokens: 5,
        latencyMs: 1,
        retries: 0,
        estimatedCost: null,
        currency: null,
        pricingVersion: null,
        costReason: 'no_pricing_table',
        success: true,
        at: new Date().toISOString(),
      })
      return ok(input)
    })

    const report = await runBatch(items(10), worker, { concurrency: 1, tracker })

    expect(report.stopReason).toBe('budget_denied')
    expect(report.budgetReason).toBe('requests_exceeded')
    expect(report.succeeded).toBe(3)
    expect(report.skipped).toBe(7)
    expect(worker).toHaveBeenCalledTimes(3)
  })

  it('denies immediately when a cost cap cannot be measured', async () => {
    // A cap set without pricing enforces nothing. Refusing is the only
    // honest response — the alternative is unlimited spend behind a
    // limit the operator believes is active.
    const tracker = createUsageTracker({ limits: { maxCost: 5 }, pricing: null })
    const worker = vi.fn(async (input: number) => ok(input))

    const report = await runBatch(items(4), worker, { tracker })

    expect(report.stopReason).toBe('budget_denied')
    expect(report.budgetReason).toBe('cost_unmeasurable')
    expect(worker).not.toHaveBeenCalled()
    expect(report.skipped).toBe(4)
  })

  it('stops on an aborted signal', async () => {
    const controller = new AbortController()
    const report = await runBatch(
      items(10),
      async (input) => {
        if (input === 1) controller.abort()
        return ok(input)
      },
      { concurrency: 1, signal: controller.signal }
    )

    expect(report.stopReason).toBe('aborted')
    expect(report.skipped).toBeGreaterThan(0)
  })

  it('handles an empty batch without hanging', async () => {
    const report = await runBatch([], async () => ok(1))
    expect(report.results).toEqual([])
    expect(report.stopReason).toBe('completed')
    expect(report.skipped).toBe(0)
  })

  it('does not let a throwing progress callback break the run', async () => {
    const report = await runBatch(items(3), async (input) => ok(input), {
      onProgress: () => {
        throw new Error('caller bug')
      },
    })
    expect(report.succeeded).toBe(3)
  })

  it('reports progress with a running count', async () => {
    const seen: number[] = []
    await runBatch(items(4), async (input) => ok(input), {
      concurrency: 1,
      onProgress: ({ completed }) => void seen.push(completed),
    })
    expect(seen).toEqual([1, 2, 3, 4])
  })
})
