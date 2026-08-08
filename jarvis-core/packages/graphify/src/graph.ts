import type {
  CodeGraph,
  GraphEdge,
  GraphNode,
  IndexState,
  IndexedFileState,
  UnresolvedImport,
} from './types'

// ---------------------------------------------------------------------
// Graph construction from indexed file state.
//
// Pure: state in, graph out. No filesystem, no network, no model. That
// makes a rebuild free, which in turn means the graph never has to be
// persisted separately from the state that produces it — one source of
// truth instead of two that can drift.
// ---------------------------------------------------------------------

/** Extensions tried when an import omits one, in resolution order. */
const RESOLUTION_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']
const INDEX_BASENAMES = RESOLUTION_EXTENSIONS.map((extension) => `index${extension}`)

/**
 * Relative imports of non-code files. The walker indexes code, so these
 * have no node by design and are not breakage.
 */
const ASSET_EXTENSIONS = [
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.json',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.md',
  '.mdx',
  '.txt',
  '.wasm',
]

export function isAssetSpecifier(specifier: string): boolean {
  const withoutQuery = specifier.split(/[?#]/)[0] ?? ''
  return ASSET_EXTENSIONS.some((extension) => withoutQuery.toLowerCase().endsWith(extension))
}

/** Normalises `a/./b`, `a/../b` and duplicate separators. */
export function normalisePath(path: string): string {
  const isAbsolute = path.startsWith('/')
  const parts: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      // A `..` that would escape the root is dropped, not kept: paths
      // outside the repository are not addressable in this graph.
      if (parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop()
      else if (!isAbsolute) parts.push('..')
      continue
    }
    parts.push(segment)
  }
  return (isAbsolute ? '/' : '') + parts.join('/')
}

function dirname(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? '' : path.slice(0, index)
}

/**
 * Resolves a relative import to a file that exists in the index.
 *
 * Mirrors Node/TypeScript resolution only as far as the repository
 * needs: exact path, then extension candidates, then directory index.
 * Returns null for anything it cannot place, which the caller records
 * as unresolved rather than silently dropping.
 */
export function resolveImport(
  fromFile: string,
  specifier: string,
  known: ReadonlySet<string>
): string | null {
  if (!specifier.startsWith('.')) return null

  const base = normalisePath(`${dirname(fromFile)}/${specifier}`)
  if (known.has(base)) return base

  // TypeScript source imported as '.js' — the compiled name is written
  // in the import but the file on disk is '.ts'. Common with ESM+NodeNext
  // and invisible if not handled: every such edge would go missing.
  const withoutExtension = base.replace(/\.(js|jsx|mjs|cjs)$/, '')
  for (const extension of RESOLUTION_EXTENSIONS) {
    const candidate = `${withoutExtension}${extension}`
    if (known.has(candidate)) return candidate
  }

  for (const basename of INDEX_BASENAMES) {
    const candidate = normalisePath(`${base}/${basename}`)
    if (known.has(candidate)) return candidate
  }

  return null
}

export function buildGraph(state: IndexState): CodeGraph {
  const files = Object.values(state.files)
  const known = new Set(files.map((file) => file.path))

  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const unresolved: UnresolvedImport[] = []

  // Exported symbol name -> declaring node ids. An array because a name
  // can legitimately be exported from several modules; picking one
  // arbitrarily would invent a call edge that does not exist.
  const exportsByName = new Map<string, string[]>()

  for (const file of files) {
    nodes.push({
      kind: 'file',
      id: file.path,
      language: file.language,
      hash: file.hash,
      lineCount: file.lineCount,
      ...(file.summary ? { summary: file.summary } : {}),
    })

    for (const symbol of file.symbols) {
      const id = `${file.path}#${symbol.name}`
      nodes.push({
        kind: 'symbol',
        id,
        name: symbol.name,
        symbolKind: symbol.kind,
        exported: symbol.exported,
        file: file.path,
        line: symbol.line,
      })
      edges.push({ kind: 'declares', from: file.path, to: id })

      if (symbol.exported) {
        const existing = exportsByName.get(symbol.name)
        if (existing) existing.push(id)
        else exportsByName.set(symbol.name, [id])
      }
    }
  }

  for (const file of files) {
    // Deduplicated: one module imported on five lines is one dependency,
    // and counting it five times distorts every fan-in metric.
    const seen = new Set<string>()
    for (const entry of file.imports) {
      if (!entry.relative) {
        unresolved.push({
          from: file.path,
          specifier: entry.specifier,
          line: entry.line,
          reason: 'external',
        })
        continue
      }
      const target = resolveImport(file.path, entry.specifier, known)
      if (!target) {
        unresolved.push({
          from: file.path,
          specifier: entry.specifier,
          line: entry.line,
          reason: isAssetSpecifier(entry.specifier) ? 'asset' : 'unresolved',
        })
        continue
      }
      if (seen.has(target)) continue
      seen.add(target)
      edges.push({ kind: 'imports', from: file.path, to: target })
    }
  }

  edges.push(...buildCallEdges(files, known, exportsByName))

  return { nodes, edges, unresolved, builtAt: new Date().toISOString() }
}

/**
 * Call edges, from actual call sites.
 *
 * Deliberately conservative: an edge is drawn only when a name is BOTH
 * imported into the file from a resolvable module AND appears at a real
 * call site in it. Both halves are required, and requiring only the
 * first is a trap worth naming — it yields the cartesian product of
 * every symbol against every import, which looks like a dense, useful
 * graph and is actually noise. (This function did exactly that in its
 * first version: 141 import edges produced 13,270 "call" edges.)
 *
 * It under-reports — dynamic dispatch, aliased imports and method calls
 * on objects are all missed — and that is the intended trade. A call
 * graph that misses edges is a weaker index; one that invents them
 * sends a reader to code that never runs.
 */
function buildCallEdges(
  files: readonly IndexedFileState[],
  known: ReadonlySet<string>,
  exportsByName: ReadonlyMap<string, string[]>
): GraphEdge[] {
  const edges: GraphEdge[] = []

  for (const file of files) {
    if (file.calls.length === 0) continue

    // Imported name -> the module it came from. Built from the file's
    // own resolvable imports, so a name exported by an unrelated module
    // never produces an edge here.
    const importedFrom = new Map<string, string>()
    for (const entry of file.imports) {
      if (!entry.relative) continue
      const target = resolveImport(file.path, entry.specifier, known)
      if (!target) continue
      for (const [name, ids] of exportsByName) {
        if (ids.some((id) => id.startsWith(`${target}#`))) importedFrom.set(name, target)
      }
    }
    if (importedFrom.size === 0) continue

    const declaredLocally = new Set(file.symbols.map((symbol) => symbol.name))

    for (const call of file.calls) {
      const target = importedFrom.get(call.name)
      if (!target) continue
      // A local declaration of the same name shadows the import at this
      // scope, so the call is not reaching the imported symbol.
      if (declaredLocally.has(call.name)) continue

      // A module-scope call has no enclosing declaration. The file node
      // is the caller — module initialisation is a real edge.
      const from = call.enclosing === null ? file.path : `${file.path}#${call.enclosing}`
      edges.push({ kind: 'calls', from, to: `${target}#${call.name}` })
    }
  }

  return dedupeEdges(edges)
}

function dedupeEdges(edges: readonly GraphEdge[]): GraphEdge[] {
  const seen = new Set<string>()
  const out: GraphEdge[] = []
  for (const edge of edges) {
    const key = `${edge.kind}:${edge.from}->${edge.to}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(edge)
  }
  return out
}

/** Adjacency for one edge kind. */
export function adjacency(graph: CodeGraph, kind: GraphEdge['kind']): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const edge of graph.edges) {
    if (edge.kind !== kind) continue
    const existing = map.get(edge.from)
    if (existing) existing.push(edge.to)
    else map.set(edge.from, [edge.to])
  }
  return map
}

/**
 * Every import cycle, as node paths.
 *
 * Iterative depth-first search with an explicit stack rather than
 * recursion: a deep dependency chain would blow the call stack on a
 * large repository, and that failure arrives as an unexplained crash
 * during indexing rather than as a graph problem.
 */
export function findCycles(graph: CodeGraph): string[][] {
  const graphEdges = adjacency(graph, 'imports')
  const cycles: string[][] = []
  const seenCycles = new Set<string>()
  const state = new Map<string, 'visiting' | 'done'>()

  for (const root of graphEdges.keys()) {
    if (state.get(root) === 'done') continue

    const path: string[] = []
    const stack: { node: string; childIndex: number }[] = [{ node: root, childIndex: 0 }]
    state.set(root, 'visiting')
    path.push(root)

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      if (!frame) break

      const children = graphEdges.get(frame.node) ?? []
      if (frame.childIndex >= children.length) {
        state.set(frame.node, 'done')
        stack.pop()
        path.pop()
        continue
      }

      const child = children[frame.childIndex]
      frame.childIndex += 1
      if (child === undefined) continue

      if (state.get(child) === 'visiting') {
        const start = path.indexOf(child)
        if (start !== -1) {
          const cycle = path.slice(start)
          // Rotate to a canonical starting point so the same cycle
          // discovered from two entry points is reported once.
          const min = cycle.reduce((a, b) => (a < b ? a : b))
          const offset = cycle.indexOf(min)
          const canonical = [...cycle.slice(offset), ...cycle.slice(0, offset)]
          const key = canonical.join('>')
          if (!seenCycles.has(key)) {
            seenCycles.add(key)
            cycles.push(canonical)
          }
        }
        continue
      }

      if (state.get(child) === 'done') continue

      state.set(child, 'visiting')
      path.push(child)
      stack.push({ node: child, childIndex: 0 })
    }
  }

  return cycles
}
