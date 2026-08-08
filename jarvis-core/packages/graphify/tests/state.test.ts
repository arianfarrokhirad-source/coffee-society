import { describe, expect, it } from 'vitest'
import { contentHash } from '@jarvis/ai'
import {
  detectChanges,
  loadState,
  markRunCompleted,
  markRunStarted,
  type StateStore,
} from '../src/state'
import { emptyIndexState, INDEX_STATE_VERSION, type IndexState } from '../src/types'

// Change detection and crash recovery. Both exist to answer one
// question — "what actually needs re-doing?" — and both fail silently
// when they are wrong, which is why they are pinned this closely.

function memoryStore(initial: string | null = null): StateStore & { contents: string | null } {
  const store = {
    contents: initial,
    async read() {
      return store.contents
    },
    async write(next: string) {
      store.contents = next
    },
  }
  return store
}

function stateWith(files: Record<string, string>): IndexState {
  const state = emptyIndexState()
  for (const [path, content] of Object.entries(files)) {
    state.files[path] = {
      path,
      hash: contentHash(content),
      language: 'typescript',
      lineCount: content.split('\n').length,
      symbols: [],
      imports: [],
      calls: [],
      indexedAt: new Date().toISOString(),
    }
  }
  return state
}

describe('detectChanges', () => {
  it('classifies added, modified, deleted and unchanged', () => {
    const state = stateWith({ 'a.ts': 'alpha', 'b.ts': 'beta', 'gone.ts': 'x' })
    const changes = detectChanges(state, [
      { path: 'a.ts', content: 'alpha' },
      { path: 'b.ts', content: 'beta CHANGED' },
      { path: 'c.ts', content: 'new' },
    ])

    expect(changes.unchanged).toEqual(['a.ts'])
    expect(changes.modified).toEqual(['b.ts'])
    expect(changes.added).toEqual(['c.ts'])
    expect(changes.deleted).toEqual(['gone.ts'])
  })

  it('compares content, not timestamps', () => {
    // mtime lies: a fresh clone sets every file to now, and `git
    // checkout` of an older branch can move it backwards. Identical
    // content must read as unchanged no matter when it was written.
    const state = stateWith({ 'a.ts': 'same' })
    const changes = detectChanges(state, [{ path: 'a.ts', content: 'same' }])
    expect(changes.unchanged).toEqual(['a.ts'])
    expect(changes.modified).toEqual([])
  })

  it('detects a deletion, which is the pass that makes an index wrong when missed', () => {
    const state = stateWith({ 'removed.ts': 'x' })
    expect(detectChanges(state, []).deleted).toEqual(['removed.ts'])
  })

  it('treats everything as added on a first run', () => {
    const changes = detectChanges(emptyIndexState(), [{ path: 'a.ts', content: 'x' }])
    expect(changes.added).toEqual(['a.ts'])
    expect(changes.deleted).toEqual([])
  })
})

describe('loadState', () => {
  it('returns an empty index on a first run', async () => {
    const loaded = await loadState(memoryStore(null))
    expect(loaded.state.files).toEqual({})
    expect(loaded.recoveredFromCrash).toBe(false)
    expect(loaded.discarded).toBeUndefined()
  })

  it('discards unparseable state rather than throwing', async () => {
    // A corrupt state file must cost one full re-index, not an outage.
    const loaded = await loadState(memoryStore('{not json'))
    expect(loaded.discarded).toBe('unreadable')
    expect(loaded.state.files).toEqual({})
  })

  it('discards state written by a different version', async () => {
    // An older layout may encode hashes that no longer mean the same
    // thing. Reusing it produces an index that is subtly wrong.
    const stale = JSON.stringify({ ...emptyIndexState(), version: INDEX_STATE_VERSION - 1 })
    const loaded = await loadState(memoryStore(stale))
    expect(loaded.discarded).toBe('version_mismatch')
  })

  it('survives a store that throws on read', async () => {
    const loaded = await loadState({
      read: async () => {
        throw new Error('disk error')
      },
      write: async () => {},
    })
    expect(loaded.discarded).toBe('unreadable')
  })

  it('reports a crash when the in-progress flag is still set', async () => {
    const crashed = JSON.stringify({ ...stateWith({ 'a.ts': 'x' }), inProgress: true })
    const loaded = await loadState(memoryStore(crashed))
    expect(loaded.recoveredFromCrash).toBe(true)
    // Records written before the crash are individually whole and kept.
    expect(Object.keys(loaded.state.files)).toEqual(['a.ts'])
  })

  it('does not report a crash after a clean run', async () => {
    const store = memoryStore()
    await markRunCompleted(store, stateWith({ 'a.ts': 'x' }))
    const loaded = await loadState(store)
    expect(loaded.recoveredFromCrash).toBe(false)
    expect(loaded.state.lastCompletedAt).toBeTruthy()
  })
})

describe('run markers', () => {
  it('sets the in-progress flag before work and clears it after', async () => {
    const store = memoryStore()
    const state = stateWith({ 'a.ts': 'x' })

    await markRunStarted(store, state)
    expect(JSON.parse(store.contents ?? '{}').inProgress).toBe(true)

    await markRunCompleted(store, state)
    const written = JSON.parse(store.contents ?? '{}')
    expect(written.inProgress).toBe(false)
    expect(written.version).toBe(INDEX_STATE_VERSION)
    expect(written.lastCompletedAt).toBeTruthy()
  })
})
