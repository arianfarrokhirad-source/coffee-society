import type { ExtractedCall, ExtractedSymbol, ModuleSummary, SymbolKind } from '@jarvis/ai'

// ---------------------------------------------------------------------
// Graphify — the code memory.
//
// The boundary that matters, and the one PRIME set: Graphify stores CODE
// knowledge. Obsidian stores HUMAN knowledge. A fact that can be derived
// from the repository belongs here and must not be duplicated there,
// because a duplicated fact is a fact that will disagree with itself the
// first time the code changes and the note does not.
//
// Four graphs over one node set, because they answer different
// questions and have different edges:
//
//   dependency — which file pulls in which file. Answers "what breaks
//     if I change this?" and "where are the cycles?".
//   symbol     — which file declares which name. Answers "where is X
//     defined?" without a full-text search over a repository.
//   function   — which function calls which. Answers "who uses this?".
//   semantic   — which modules are ABOUT the same thing. The only graph
//     that needs a model, and the only one that is approximate by
//     nature rather than by implementation shortcut.
//
// The first three are derived by parsing and are exact-ish, free and
// instant. The semantic graph costs money. They are built separately so
// a cheap re-index does not drag the expensive one along with it.
// ---------------------------------------------------------------------

export type NodeKind = 'file' | 'symbol'

export interface FileNode {
  kind: 'file'
  /** Repository-relative path, POSIX separators. The node's identity. */
  id: string
  language: string
  hash: string
  lineCount: number
  summary?: ModuleSummary
}

export interface SymbolNode {
  kind: 'symbol'
  /** `path#name` — unique, and readable in a report without a lookup. */
  id: string
  name: string
  symbolKind: SymbolKind
  exported: boolean
  file: string
  line: number
}

export type GraphNode = FileNode | SymbolNode

export type EdgeKind =
  /** file → file, from an import statement. */
  | 'imports'
  /** file → symbol, from a declaration. */
  | 'declares'
  /** symbol → symbol, from a call site. */
  | 'calls'
  /** file → file, from embedding proximity. Approximate by nature. */
  | 'related_to'

export interface GraphEdge {
  kind: EdgeKind
  from: string
  to: string
  /** Only set on 'related_to'; cosine similarity in [-1, 1]. */
  weight?: number
}

/**
 * An import that could not be resolved to a file in the repository.
 *
 * Kept rather than dropped. A dangling edge silently removed is a hole
 * in the graph nobody can see; recorded, it is a health signal that
 * distinguishes "external package" from "broken path".
 */
export interface UnresolvedImport {
  from: string
  specifier: string
  line: number
  /**
   * `external`  — a package, not a repository file. Expected.
   * `asset`     — a relative stylesheet/image/JSON import. Expected: the
   *               walker indexes code, so these have no node by design.
   * `unresolved`— a relative CODE import pointing at nothing. A defect.
   *
   * Assets are separated from genuine breakage because conflating them
   * meant every Next.js app reported a permanent broken import for
   * `./globals.css`. A health signal that is always amber is one people
   * learn to ignore, which costs more than not having it.
   */
  reason: 'external' | 'asset' | 'unresolved'
}

export interface CodeGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  unresolved: UnresolvedImport[]
  /** ISO timestamp of the build that produced this graph. */
  builtAt: string
}

/** Per-file record in the persisted index, used for change detection. */
export interface IndexedFileState {
  path: string
  hash: string
  language: string
  lineCount: number
  symbols: ExtractedSymbol[]
  imports: { specifier: string; relative: boolean; line: number }[]
  calls: ExtractedCall[]
  summary?: ModuleSummary
  /** ISO timestamp this file was last indexed. */
  indexedAt: string
}

/** 2 — added `calls`; a v1 state has no call sites and must be rebuilt. */
export const INDEX_STATE_VERSION = 2

export interface IndexState {
  /**
   * Bumped when the shape of this file or the meaning of a hash
   * changes. A state written by an older version is discarded rather
   * than half-read — an index that is subtly wrong is worse than one
   * that is missing, because nothing signals the error.
   */
  version: number
  /** Set while a run is in progress; a leftover marks a crash. */
  inProgress: boolean
  /** ISO timestamp of the last completed run. */
  lastCompletedAt: string | null
  files: Record<string, IndexedFileState>
}

export function emptyIndexState(): IndexState {
  return {
    version: INDEX_STATE_VERSION,
    inProgress: false,
    lastCompletedAt: null,
    files: {},
  }
}

/** What a run actually had to do. The proof that it stayed incremental. */
export interface ChangeSet {
  added: string[]
  modified: string[]
  deleted: string[]
  /** Files whose hash matched and which were therefore not re-read. */
  unchanged: string[]
}

export function isEmptyChangeSet(changes: ChangeSet): boolean {
  return changes.added.length === 0 && changes.modified.length === 0 && changes.deleted.length === 0
}
