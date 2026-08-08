import { extractRepository, type EmbeddingClient, type AIRouter, type SourceFile } from '@jarvis/ai'
import { err, ok, type Result } from '@jarvis/shared'
import { buildGraph } from './graph'
import {
  detectChanges,
  loadState,
  markRunCompleted,
  markRunStarted,
  type ObservedFile,
  type StateStore,
} from './state'
import type { ChangeSet, CodeGraph, IndexState } from './types'

// ---------------------------------------------------------------------
// The incremental indexer.
//
// PRIME's requirement: "Graphify must automatically update after
// repository changes. No unnecessary full scans."
//
// What that means concretely, and what this file guarantees:
//
//   * a run that finds nothing changed does NO extraction and NO
//     embedding, and says so;
//   * only added and modified files are re-extracted — unchanged files
//     keep their existing records verbatim;
//   * deleted files are removed from the index, which is the pass most
//     often forgotten and the one that makes an index actively wrong
//     rather than merely incomplete;
//   * the expensive semantic pass is opt-in and independent of the free
//     structural pass.
//
// "No unnecessary full scans" is about EXTRACTION, not about reading.
// Every candidate file is still read, because a content hash is the only
// trustworthy change signal (see state.ts on why mtime is not). Reading
// is cheap; extracting and embedding are not.
// ---------------------------------------------------------------------

export interface IndexRunOptions {
  /** Omit to index structurally only — free, offline, deterministic. */
  router?: AIRouter
  embeddings?: EmbeddingClient
  concurrency?: number
  /**
   * Re-extracts everything even when hashes match. Reserved for a
   * changed extraction format; routine runs must never set it.
   */
  force?: boolean
}

export interface IndexRunReport {
  changes: ChangeSet
  graph: CodeGraph
  /** Files actually sent for extraction. 0 on a no-op run. */
  extracted: number
  /** True when nothing changed and no model was called. */
  noOp: boolean
  recoveredFromCrash: boolean
  discardedState?: 'version_mismatch' | 'unreadable'
  durationMs: number
}

/**
 * Runs one incremental index pass.
 *
 * Takes observed files rather than a path so the core is testable
 * without a filesystem; `indexRepositoryFromDisk` supplies the walker.
 */
export async function runIndex(
  store: StateStore,
  observed: readonly ObservedFile[],
  options: IndexRunOptions = {}
): Promise<Result<IndexRunReport>> {
  const started = Date.now()
  const loaded = await loadState(store)
  const state: IndexState = loaded.state

  const changes = options.force
    ? {
        added: observed.map((file) => file.path),
        modified: [],
        deleted: Object.keys(state.files).filter(
          (path) => !observed.some((file) => file.path === path)
        ),
        unchanged: [],
      }
    : detectChanges(state, observed)

  // A crashed previous run leaves records that are individually whole
  // but a deletion pass that may not have finished. Re-running deletion
  // is cheap, so recovery costs nothing beyond this pass.
  const stale = changes.deleted.length > 0

  if (
    changes.added.length === 0 &&
    changes.modified.length === 0 &&
    !stale &&
    !loaded.recoveredFromCrash
  ) {
    return ok({
      changes,
      graph: buildGraph(state),
      extracted: 0,
      noOp: true,
      recoveredFromCrash: false,
      ...(loaded.discarded ? { discardedState: loaded.discarded } : {}),
      durationMs: Date.now() - started,
    })
  }

  await markRunStarted(store, state)

  const byPath = new Map(observed.map((file) => [file.path, file.content]))
  const toExtract: SourceFile[] = [...changes.added, ...changes.modified]
    .map((path) => ({ path, content: byPath.get(path) ?? '' }))
    .filter((file) => file.content !== '')

  const nextFiles: IndexState['files'] = {}

  // Unchanged files keep their records verbatim — this is the line that
  // makes the run incremental. Re-deriving them would be correct and
  // pointless.
  for (const path of changes.unchanged) {
    const previous = state.files[path]
    if (previous) nextFiles[path] = previous
  }

  if (toExtract.length > 0) {
    const extraction = await extractRepository(toExtract, {
      ...(options.router ? { router: options.router } : {}),
      ...(options.embeddings ? { embeddings: options.embeddings } : {}),
      ...(options.concurrency != null ? { concurrency: options.concurrency } : {}),
    })
    if (!extraction.ok) return err(`Indexing failed: ${extraction.error}`)

    const indexedAt = new Date().toISOString()
    for (const file of extraction.value.files) {
      nextFiles[file.path] = {
        path: file.path,
        hash: file.hash,
        language: file.language,
        lineCount: file.lineCount,
        symbols: file.symbols,
        imports: file.imports,
        calls: file.calls,
        ...(file.summary ? { summary: file.summary } : {}),
        indexedAt,
      }
    }
  }

  // Deleted files are simply absent from nextFiles — the index is
  // rebuilt from what exists rather than patched, so a forgotten
  // removal is structurally impossible.
  const nextState: IndexState = { ...state, files: nextFiles }
  await markRunCompleted(store, nextState)

  return ok({
    changes,
    graph: buildGraph(nextState),
    extracted: toExtract.length,
    noOp: false,
    recoveredFromCrash: loaded.recoveredFromCrash,
    ...(loaded.discarded ? { discardedState: loaded.discarded } : {}),
    durationMs: Date.now() - started,
  })
}
