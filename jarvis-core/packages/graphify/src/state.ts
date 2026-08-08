import { contentHash } from '@jarvis/ai'
import { emptyIndexState, INDEX_STATE_VERSION, type ChangeSet, type IndexState } from './types'

// ---------------------------------------------------------------------
// Change detection and crash recovery.
//
// Change detection uses CONTENT HASHES, not modification times. mtime is
// the obvious choice and it is wrong here for reasons that only show up
// in production:
//
//   * a fresh clone or a CI checkout sets every mtime to now, so an
//     mtime index re-scans the entire repository on every build;
//   * `git checkout` of an older branch can move a file's mtime
//     BACKWARDS, so a real change looks like no change and the index
//     silently serves stale data;
//   * touching a file without editing it forces pointless re-indexing.
//
// A content hash has none of those failure modes. It costs one read per
// candidate file, which is cheap next to what re-embedding costs.
//
// Crash recovery uses an in-progress flag plus atomic writes. The flag
// is set before work starts and cleared after it completes, so a state
// file found with the flag still set means the previous run died
// mid-write. Recovery is deliberately conservative: trust the file
// records that are there (each was written whole), but treat the run as
// incomplete so the next one re-verifies rather than assuming the
// deleted-file pass finished.
// ---------------------------------------------------------------------

/** Ports the index needs, injectable so the core stays testable. */
export interface StateStore {
  read(): Promise<string | null>
  /** Must be atomic: write to a temp path, then rename over the target. */
  write(contents: string): Promise<void>
}

export interface LoadedState {
  state: IndexState
  /**
   * True when the previous run did not finish. The caller must not
   * trust `lastCompletedAt` and should re-verify deletions.
   */
  recoveredFromCrash: boolean
  /** Set when a stored state was discarded and why. */
  discarded?: 'version_mismatch' | 'unreadable'
}

/**
 * Reads persisted state, degrading to an empty index rather than
 * throwing. A corrupt state file must cost one full re-index, not an
 * outage — and it must say so, so the full scan is explainable.
 */
export async function loadState(store: StateStore): Promise<LoadedState> {
  let raw: string | null
  try {
    raw = await store.read()
  } catch {
    return { state: emptyIndexState(), recoveredFromCrash: false, discarded: 'unreadable' }
  }

  if (raw === null) return { state: emptyIndexState(), recoveredFromCrash: false }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { state: emptyIndexState(), recoveredFromCrash: false, discarded: 'unreadable' }
  }

  if (!isIndexState(parsed)) {
    return { state: emptyIndexState(), recoveredFromCrash: false, discarded: 'unreadable' }
  }

  if (parsed.version !== INDEX_STATE_VERSION) {
    // An index from an older layout may encode hashes or symbol shapes
    // that no longer mean the same thing. Reusing it would produce an
    // index that is subtly wrong with nothing to signal it.
    return { state: emptyIndexState(), recoveredFromCrash: false, discarded: 'version_mismatch' }
  }

  return { state: parsed, recoveredFromCrash: parsed.inProgress }
}

function isIndexState(value: unknown): value is IndexState {
  if (typeof value !== 'object' || value === null) return false
  const state = value as Partial<IndexState>
  return (
    typeof state.version === 'number' &&
    typeof state.inProgress === 'boolean' &&
    typeof state.files === 'object' &&
    state.files !== null
  )
}

export async function markRunStarted(store: StateStore, state: IndexState): Promise<void> {
  await store.write(JSON.stringify({ ...state, inProgress: true }))
}

export async function markRunCompleted(store: StateStore, state: IndexState): Promise<void> {
  await store.write(
    JSON.stringify({
      ...state,
      version: INDEX_STATE_VERSION,
      inProgress: false,
      lastCompletedAt: new Date().toISOString(),
    })
  )
}

/** A file as seen on disk right now. */
export interface ObservedFile {
  path: string
  content: string
}

/**
 * Compares what is on disk against what was indexed.
 *
 * Takes already-read contents rather than reading itself, so the same
 * function serves the filesystem walker and the tests without either
 * mocking `fs` or touching a real one.
 */
export function detectChanges(state: IndexState, observed: readonly ObservedFile[]): ChangeSet {
  const added: string[] = []
  const modified: string[] = []
  const unchanged: string[] = []
  const seen = new Set<string>()

  for (const file of observed) {
    seen.add(file.path)
    const previous = state.files[file.path]
    if (!previous) {
      added.push(file.path)
      continue
    }
    if (previous.hash === contentHash(file.content)) unchanged.push(file.path)
    else modified.push(file.path)
  }

  // A file in the index but no longer on disk. Missing this pass leaves
  // deleted modules answering queries forever — the failure mode that
  // makes a code index untrustworthy rather than merely incomplete.
  const deleted = Object.keys(state.files).filter((path) => !seen.has(path))

  return { added, modified, deleted, unchanged }
}
