import { type Result } from '@jarvis/shared'
import type { BudgetDenialReason, UsageTracker } from './usage'

// ---------------------------------------------------------------------
// Batch processing.
//
// Bulk work is where an AI system stops being a chat feature and starts
// being infrastructure — and where the three failure modes that matter
// all live:
//
//   Unbounded concurrency. 4,000 files launched at once is a
//     self-inflicted denial of service: the provider rate-limits, every
//     request retries, and the retries collide. Concurrency is bounded
//     here, always.
//
//   Chunked Promise.all. The obvious bounded design — slice into groups
//     of N and await each group — has a convoy problem: every group runs
//     at the speed of its slowest member, and lanes sit idle waiting.
//     A worker pool pulling from a shared cursor keeps all N lanes busy
//     and is why this file is longer than a one-line Promise.all.
//
//   Failing the run on one bad item. One unparseable file must not
//     discard 3,999 good extractions. Failures are recorded per item;
//     the batch reports them and carries on.
//
// The exception to "carry on" is budget denial. That is not this item
// failing, it is the run being out of money, and continuing would spend
// past a cap the operator set.
// ---------------------------------------------------------------------

export interface BatchItem<TInput> {
  /** Caller-owned identity, echoed on the result. */
  id: string
  input: TInput
}

export interface BatchItemResult<TOutput> {
  id: string
  /** Position in the input array. Results are returned in this order. */
  index: number
  ok: boolean
  value?: TOutput
  error?: string
  /** Wall-clock time for this item alone. */
  latencyMs: number
}

export type BatchStopReason = 'completed' | 'budget_denied' | 'aborted'

export interface BatchReport<TOutput> {
  results: BatchItemResult<TOutput>[]
  succeeded: number
  failed: number
  /** Items never attempted, because the run stopped early. */
  skipped: number
  stopReason: BatchStopReason
  /** Set only when stopReason is 'budget_denied'. */
  budgetReason?: BudgetDenialReason
  totalLatencyMs: number
}

export interface BatchOptions {
  /**
   * Lanes running at once. Default 4 — low enough to stay under a
   * typical free-tier rate limit, high enough that latency-bound work
   * is not serialised.
   */
  concurrency?: number
  /** Consulted before each item is started; stops the run when denied. */
  tracker?: UsageTracker
  signal?: AbortSignal
  /** Called after each item settles. Never allowed to break the run. */
  onProgress?: (progress: { completed: number; total: number; lastId: string; ok: boolean }) => void
}

export const DEFAULT_BATCH_CONCURRENCY = 4

/**
 * Runs `worker` over every item with bounded concurrency.
 *
 * The worker returns a Result rather than throwing, matching the rest of
 * the codebase — but a worker that throws anyway is caught and recorded
 * as a failed item, because one badly behaved worker must not take the
 * pool down with it.
 */
export async function runBatch<TInput, TOutput>(
  items: readonly BatchItem<TInput>[],
  worker: (input: TInput, item: BatchItem<TInput>) => Promise<Result<TOutput>>,
  options: BatchOptions = {}
): Promise<BatchReport<TOutput>> {
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_BATCH_CONCURRENCY)
  const started = Date.now()

  // Sparse array indexed by input position, so completion order never
  // leaks into the output. Callers zip results back onto their own data
  // by index; shuffling here would corrupt that silently.
  const results: (BatchItemResult<TOutput> | undefined)[] = new Array(items.length)

  let cursor = 0
  let completed = 0
  let stopReason: BatchStopReason = 'completed'
  let budgetReason: BudgetDenialReason | undefined
  let stopped = false

  async function lane(): Promise<void> {
    for (;;) {
      if (stopped) return

      if (options.signal?.aborted) {
        stopped = true
        stopReason = 'aborted'
        return
      }

      // Budget is checked per item, not once up front: spend accumulates
      // while the batch runs, so a cap can be reached mid-run.
      const verdict = options.tracker?.check()
      if (verdict && !verdict.allowed) {
        stopped = true
        stopReason = 'budget_denied'
        budgetReason = verdict.reason
        return
      }

      // Claiming the index before awaiting is what makes the shared
      // cursor safe here: JavaScript's single-threaded turn means no
      // other lane can interleave between the read and the increment.
      const index = cursor
      cursor += 1
      if (index >= items.length) return

      const item = items[index]
      if (!item) return

      const itemStarted = Date.now()
      let result: BatchItemResult<TOutput>
      try {
        const outcome = await worker(item.input, item)
        result = outcome.ok
          ? {
              id: item.id,
              index,
              ok: true,
              value: outcome.value,
              latencyMs: Date.now() - itemStarted,
            }
          : {
              id: item.id,
              index,
              ok: false,
              error: outcome.error,
              latencyMs: Date.now() - itemStarted,
            }
      } catch (cause) {
        result = {
          id: item.id,
          index,
          ok: false,
          error: cause instanceof Error ? cause.message : 'worker threw a non-Error',
          latencyMs: Date.now() - itemStarted,
        }
      }

      results[index] = result
      completed += 1

      // A throwing progress callback is the caller's bug, and it must
      // not abort a run that is otherwise succeeding.
      try {
        options.onProgress?.({
          completed,
          total: items.length,
          lastId: item.id,
          ok: result.ok,
        })
      } catch {
        // Intentionally ignored.
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => lane()))

  const settled = results.filter((entry): entry is BatchItemResult<TOutput> => entry !== undefined)

  return {
    results: settled,
    succeeded: settled.filter((entry) => entry.ok).length,
    failed: settled.filter((entry) => !entry.ok).length,
    skipped: items.length - settled.length,
    stopReason,
    ...(budgetReason ? { budgetReason } : {}),
    totalLatencyMs: Date.now() - started,
  }
}
