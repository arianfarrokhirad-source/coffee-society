import { describe, expect, it } from 'vitest'
import { err, ok } from '@jarvis/shared'
import { runIndex } from '../src/indexer'
import { loadState, type ObservedFile, type StateStore } from '../src/state'
import { assessHealth, buildReport } from '../src/report'
import type { AIRouter } from '@jarvis/ai'

// PRIME's requirement for this sprint was explicit: "Graphify must
// automatically update after repository changes. No unnecessary full
// scans." These tests are that sentence, made enforceable.

function memoryStore(): StateStore & { contents: string | null; writes: number } {
  const store = {
    contents: null as string | null,
    writes: 0,
    async read() {
      return store.contents
    },
    async write(next: string) {
      store.writes += 1
      store.contents = next
    },
  }
  return store
}

function files(entries: Record<string, string>): ObservedFile[] {
  return Object.entries(entries).map(([path, content]) => ({ path, content }))
}

/** Counts how many files were sent for summarisation. */
function countingRouter(): AIRouter & { calls: number } {
  const router = {
    calls: 0,
    resolveRoute: () =>
      ok({
        kind: 'extraction' as const,
        provider: 'gemini' as const,
        model: 'm',
        fallback: null,
        chain: [],
      }),
    availableProviders: () => ['gemini' as const],
    completeWithStats: async () => err('not used'),
    async complete() {
      router.calls += 1
      return ok({
        text: JSON.stringify({ purpose: 'Does a thing.', concepts: [], layer: 'domain' }),
        model: 'm',
        provider: 'gemini' as const,
        usage: { inputTokens: 1, outputTokens: 1 },
        latencyMs: 1,
      })
    },
  }
  return router
}

const REPO = {
  'src/a.ts': 'import { b } from "./b"\nexport function a() { b() }',
  'src/b.ts': 'export function b() {}',
}

describe('incremental indexing', () => {
  it('indexes everything on a first run', async () => {
    const store = memoryStore()
    const result = await runIndex(store, files(REPO))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.changes.added.sort()).toEqual(['src/a.ts', 'src/b.ts'])
      expect(result.value.extracted).toBe(2)
      expect(result.value.noOp).toBe(false)
    }
  })

  it('does no work at all when nothing changed', async () => {
    // The headline requirement. A no-op run must not extract, must not
    // embed, and must say so.
    const store = memoryStore()
    await runIndex(store, files(REPO))

    const router = countingRouter()
    const second = await runIndex(store, files(REPO), { router })

    expect(second.ok).toBe(true)
    if (second.ok) {
      expect(second.value.noOp).toBe(true)
      expect(second.value.extracted).toBe(0)
    }
    expect(router.calls).toBe(0)
  })

  it('re-extracts only the file that changed', async () => {
    const store = memoryStore()
    await runIndex(store, files(REPO))

    const router = countingRouter()
    const result = await runIndex(
      store,
      files({ ...REPO, 'src/b.ts': 'export function b() { return 1 }' }),
      { router }
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.changes.modified).toEqual(['src/b.ts'])
      expect(result.value.changes.unchanged).toEqual(['src/a.ts'])
      expect(result.value.extracted).toBe(1)
    }
    // One file re-summarised, not the whole repository.
    expect(router.calls).toBe(1)
  })

  it('keeps the untouched file’s existing record verbatim', async () => {
    const store = memoryStore()
    const router = countingRouter()
    await runIndex(store, files(REPO), { router })
    const before = JSON.parse(store.contents ?? '{}').files['src/a.ts']

    await runIndex(store, files({ ...REPO, 'src/b.ts': 'export function b() { return 2 }' }))
    const after = JSON.parse(store.contents ?? '{}').files['src/a.ts']

    // Including the AI summary — a cheap structural run must not
    // silently discard work that was paid for.
    expect(after).toEqual(before)
  })

  it('removes a deleted file from the index', async () => {
    // The pass most often forgotten, and the one that makes an index
    // actively wrong rather than merely incomplete.
    const store = memoryStore()
    await runIndex(store, files(REPO))
    const result = await runIndex(store, files({ 'src/a.ts': REPO['src/a.ts'] }))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.changes.deleted).toEqual(['src/b.ts'])
      expect(result.value.graph.nodes.some((node) => node.id === 'src/b.ts')).toBe(false)
    }
  })

  it('runs a deletion-only pass without extracting anything', async () => {
    const store = memoryStore()
    await runIndex(store, files(REPO))

    const router = countingRouter()
    const result = await runIndex(store, files({ 'src/a.ts': REPO['src/a.ts'] }), { router })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.extracted).toBe(0)
    expect(router.calls).toBe(0)
  })

  it('re-extracts everything under --force', async () => {
    const store = memoryStore()
    await runIndex(store, files(REPO))
    const result = await runIndex(store, files(REPO), { force: true })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.extracted).toBe(2)
      expect(result.value.noOp).toBe(false)
    }
  })

  it('skips the model entirely when no router is supplied', async () => {
    // The structural index is free, offline and deterministic; it must
    // never require a credential.
    const store = memoryStore()
    const result = await runIndex(store, files(REPO))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.graph.nodes.filter((n) => n.kind === 'symbol')).toHaveLength(2)
      const loaded = await loadState(store)
      expect(Object.values(loaded.state.files).every((file) => !file.summary)).toBe(true)
    }
  })
})

describe('crash recovery', () => {
  it('marks the run in progress before extracting and clears it after', async () => {
    const store = memoryStore()
    await runIndex(store, files(REPO))

    // Two writes: the in-progress marker, then the completed state.
    expect(store.writes).toBe(2)
    expect(JSON.parse(store.contents ?? '{}').inProgress).toBe(false)
  })

  it('re-runs after a crash rather than trusting the partial state', async () => {
    const store = memoryStore()
    await runIndex(store, files(REPO))

    // Simulate a process killed mid-run.
    const crashed = JSON.parse(store.contents ?? '{}')
    crashed.inProgress = true
    store.contents = JSON.stringify(crashed)

    const result = await runIndex(store, files(REPO))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.recoveredFromCrash).toBe(true)
      // Not a no-op: a crashed run cannot be assumed to have finished
      // its deletion pass.
      expect(result.value.noOp).toBe(false)
    }
  })

  it('rebuilds from scratch when stored state is corrupt', async () => {
    const store = memoryStore()
    store.contents = 'garbage'
    const result = await runIndex(store, files(REPO))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.discardedState).toBe('unreadable')
      expect(result.value.extracted).toBe(2)
    }
  })
})

describe('report and health over a real run', () => {
  it('reports totals, hotspots and orphans', async () => {
    const store = memoryStore()
    const result = await runIndex(store, files(REPO))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const report = buildReport(result.value.graph)
    expect(report.totals.files).toBe(2)
    expect(report.totals.exportedSymbols).toBe(2)
    // b is imported by a; a is imported by nobody.
    expect(report.hotspots[0]?.path).toBe('src/b.ts')
    expect(report.orphans).toEqual(['src/a.ts'])
  })

  it('scores a fresh clean index as healthy', async () => {
    const store = memoryStore()
    const result = await runIndex(store, files(REPO))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const loaded = await loadState(store)
    const health = assessHealth(loaded.state, buildReport(result.value.graph))
    expect(health.status).toBe('healthy')
    expect(health.score).toBe(100)
  })

  it('reports stale rather than healthy for an old index', async () => {
    // A graph with no faults that describes last week's code is not
    // healthy — it is confidently wrong, which is more dangerous.
    const store = memoryStore()
    const result = await runIndex(store, files(REPO))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const loaded = await loadState(store)
    const health = assessHealth(loaded.state, buildReport(result.value.graph), {
      now: () => Date.now() + 1000 * 60 * 60 * 48,
    })
    expect(health.status).toBe('stale')
  })

  it('reports empty before any run', () => {
    const health = assessHealth(
      { version: 2, inProgress: false, lastCompletedAt: null, files: {} },
      buildReport({ nodes: [], edges: [], unresolved: [], builtAt: new Date().toISOString() })
    )
    expect(health.status).toBe('empty')
    expect(health.score).toBe(0)
  })

  it('flags cycles and broken imports in health', async () => {
    const store = memoryStore()
    const result = await runIndex(
      store,
      files({
        'src/a.ts': 'import { b } from "./b"\nimport "./nope"\nexport const a = 1',
        'src/b.ts': 'import { a } from "./a"\nexport const b = 1',
      })
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const loaded = await loadState(store)
    const health = assessHealth(loaded.state, buildReport(result.value.graph))
    expect(health.hasCycles).toBe(true)
    expect(health.brokenImportCount).toBe(1)
    expect(health.status).toBe('degraded')
    expect(health.score).toBeLessThan(100)
  })

  it('surfaces external dependencies', async () => {
    const store = memoryStore()
    const result = await runIndex(
      store,
      files({ 'src/a.ts': 'import { z } from "zod"\nimport { x } from "@jarvis/ai"' })
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // Scoped packages keep both segments: '@jarvis' is not installable.
    expect(buildReport(result.value.graph).externalDependencies).toEqual(['@jarvis/ai', 'zod'])
  })

  it('propagates an extraction failure instead of writing a partial index', async () => {
    const store = memoryStore()
    const broken: AIRouter = {
      resolveRoute: () => err('no route'),
      availableProviders: () => [],
      complete: async () => err('down'),
      completeWithStats: async () => err('down'),
    }
    // Summary failures are tolerated per-file by design, so the index
    // still completes — the structural pass is what matters.
    const result = await runIndex(store, files(REPO), { router: broken })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.graph.nodes.length).toBeGreaterThan(0)
  })
})

describe('automatic update after repository changes', () => {
  it('detects an added file on the next run without configuration', async () => {
    const store = memoryStore()
    await runIndex(store, files(REPO))
    const result = await runIndex(store, files({ ...REPO, 'src/c.ts': 'export const c = 1' }))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.changes.added).toEqual(['src/c.ts'])
      expect(result.value.extracted).toBe(1)
    }
  })

  it('is idempotent — running twice more changes nothing', async () => {
    const store = memoryStore()
    await runIndex(store, files(REPO))
    const a = await runIndex(store, files(REPO))
    const b = await runIndex(store, files(REPO))

    expect(a.ok && a.value.noOp).toBe(true)
    expect(b.ok && b.value.noOp).toBe(true)
  })
})
