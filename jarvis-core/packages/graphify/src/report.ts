import { findCycles } from './graph'
import type { CodeGraph, GraphNode, IndexState } from './types'

// ---------------------------------------------------------------------
// Graph reports and health.
//
// A graph nobody reads is a database nobody queries. These are the
// questions worth asking of a code memory, chosen because each one
// changes a decision:
//
//   hotspots — high fan-in modules. Changing one is expensive, so this
//     is the "be careful here" list and the review-priority list.
//   orphans  — files nothing imports. Either dead code to delete or an
//     entry point; the report cannot tell which, so it says so rather
//     than guessing and deleting something load-bearing.
//   cycles   — mutual imports. These break incremental builds, defeat
//     tree-shaking, and make module initialisation order matter.
//
// Health is scored separately and deliberately conservatively: a health
// number that is green while the index is stale is worse than no number,
// because it stops anyone from looking.
// ---------------------------------------------------------------------

export interface FileMetric {
  path: string
  /** Modules importing this one. High means expensive to change. */
  fanIn: number
  /** Modules this one imports. High means hard to test in isolation. */
  fanOut: number
  symbolCount: number
  lineCount: number
}

export interface GraphReport {
  totals: {
    files: number
    symbols: number
    exportedSymbols: number
    importEdges: number
    callEdges: number
    lines: number
  }
  hotspots: FileMetric[]
  orphans: string[]
  cycles: string[][]
  /** Distinct external packages the repository depends on. */
  externalDependencies: string[]
  /** Relative imports that resolve to nothing — genuinely broken. */
  brokenImports: { from: string; specifier: string; line: number }[]
  languages: Record<string, number>
}

function isFile(node: GraphNode): node is Extract<GraphNode, { kind: 'file' }> {
  return node.kind === 'file'
}

export function buildReport(graph: CodeGraph, options?: { hotspotLimit?: number }): GraphReport {
  const files = graph.nodes.filter(isFile)
  const symbols = graph.nodes.filter((node) => node.kind === 'symbol')

  const fanIn = new Map<string, number>()
  const fanOut = new Map<string, number>()
  let importEdges = 0
  let callEdges = 0

  for (const edge of graph.edges) {
    if (edge.kind === 'imports') {
      importEdges += 1
      fanOut.set(edge.from, (fanOut.get(edge.from) ?? 0) + 1)
      fanIn.set(edge.to, (fanIn.get(edge.to) ?? 0) + 1)
    } else if (edge.kind === 'calls') {
      callEdges += 1
    }
  }

  const symbolsByFile = new Map<string, number>()
  for (const symbol of symbols) {
    if (symbol.kind !== 'symbol') continue
    symbolsByFile.set(symbol.file, (symbolsByFile.get(symbol.file) ?? 0) + 1)
  }

  const metrics: FileMetric[] = files.map((file) => ({
    path: file.id,
    fanIn: fanIn.get(file.id) ?? 0,
    fanOut: fanOut.get(file.id) ?? 0,
    symbolCount: symbolsByFile.get(file.id) ?? 0,
    lineCount: file.lineCount,
  }))

  const languages: Record<string, number> = {}
  for (const file of files) languages[file.language] = (languages[file.language] ?? 0) + 1

  const externalDependencies = [
    ...new Set(
      graph.unresolved
        .filter((entry) => entry.reason === 'external')
        // Scoped packages keep two segments: '@jarvis/ai' is the
        // package, '@jarvis' is not a thing anyone installs.
        .map((entry) => {
          const parts = entry.specifier.split('/')
          return entry.specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? '')
        })
        .filter((name) => name !== '')
    ),
  ].sort()

  return {
    totals: {
      files: files.length,
      symbols: symbols.length,
      exportedSymbols: symbols.filter((node) => node.kind === 'symbol' && node.exported).length,
      importEdges,
      callEdges,
      lines: files.reduce((sum, file) => sum + file.lineCount, 0),
    },
    hotspots: [...metrics]
      .sort((a, b) => b.fanIn - a.fanIn || b.symbolCount - a.symbolCount)
      .slice(0, options?.hotspotLimit ?? 10),
    orphans: metrics
      .filter((metric) => metric.fanIn === 0)
      .map((metric) => metric.path)
      .sort(),
    cycles: findCycles(graph),
    externalDependencies,
    brokenImports: graph.unresolved
      .filter((entry) => entry.reason === 'unresolved')
      .map((entry) => ({ from: entry.from, specifier: entry.specifier, line: entry.line })),
    languages,
  }
}

export type HealthStatus = 'healthy' | 'degraded' | 'stale' | 'empty'

export interface GraphHealth {
  status: HealthStatus
  /** 0–100. Only meaningful alongside `issues`. */
  score: number
  issues: string[]
  indexedFiles: number
  lastCompletedAt: string | null
  /** Hours since the last completed run, or null if never run. */
  ageHours: number | null
  hasCycles: boolean
  brokenImportCount: number
  /** Files carrying an AI summary — the semantic graph's coverage. */
  semanticCoverage: number
}

export interface HealthOptions {
  /** Runs older than this are reported stale. Default 24h. */
  maxAgeHours?: number
  now?: () => number
}

/**
 * Scores the index.
 *
 * Staleness outranks everything: a graph with no structural faults that
 * describes last week's code is not healthy, it is confidently wrong,
 * and that is more dangerous than a graph with a visible defect.
 */
export function assessHealth(
  state: IndexState,
  report: GraphReport,
  options: HealthOptions = {}
): GraphHealth {
  const now = options.now?.() ?? Date.now()
  const maxAgeHours = options.maxAgeHours ?? 24
  const indexedFiles = Object.keys(state.files).length
  const issues: string[] = []

  const ageHours =
    state.lastCompletedAt === null
      ? null
      : (now - Date.parse(state.lastCompletedAt)) / (1000 * 60 * 60)

  const semanticCoverage = Object.values(state.files).filter((file) => file.summary).length

  if (indexedFiles === 0) {
    return {
      status: 'empty',
      score: 0,
      issues: ['Index is empty — no run has completed.'],
      indexedFiles: 0,
      lastCompletedAt: state.lastCompletedAt,
      ageHours,
      hasCycles: false,
      brokenImportCount: 0,
      semanticCoverage: 0,
    }
  }

  let score = 100

  if (state.inProgress) {
    issues.push('Previous run did not complete — index may be partial.')
    score -= 30
  }

  if (report.brokenImports.length > 0) {
    issues.push(`${report.brokenImports.length} relative import(s) resolve to nothing.`)
    score -= Math.min(25, report.brokenImports.length * 5)
  }

  if (report.cycles.length > 0) {
    issues.push(`${report.cycles.length} import cycle(s).`)
    score -= Math.min(20, report.cycles.length * 5)
  }

  const stale = ageHours === null || ageHours > maxAgeHours
  if (ageHours === null) {
    issues.push('No completed run recorded.')
    score -= 40
  } else if (stale) {
    issues.push(`Last run was ${Math.round(ageHours)}h ago (limit ${maxAgeHours}h).`)
    score -= 40
  }

  const clamped = Math.max(0, Math.min(100, score))
  // Stale is its own status rather than a low score, because the fix is
  // different: re-run the indexer, not repair the code.
  const status: HealthStatus = stale ? 'stale' : issues.length > 0 ? 'degraded' : 'healthy'

  return {
    status,
    score: clamped,
    issues,
    indexedFiles,
    lastCompletedAt: state.lastCompletedAt,
    ageHours,
    hasCycles: report.cycles.length > 0,
    brokenImportCount: report.brokenImports.length,
    semanticCoverage,
  }
}

/** Human-readable summary for a terminal or a report page. */
export function formatReport(report: GraphReport, health: GraphHealth): string {
  const lines: string[] = []
  lines.push(`Graphify — ${health.status.toUpperCase()} (score ${health.score}/100)`)
  lines.push('')
  lines.push(
    `Files ${report.totals.files} · Symbols ${report.totals.symbols} ` +
      `(${report.totals.exportedSymbols} exported) · Lines ${report.totals.lines}`
  )
  lines.push(
    `Import edges ${report.totals.importEdges} · Call edges ${report.totals.callEdges} · ` +
      `Semantic coverage ${health.semanticCoverage}/${health.indexedFiles}`
  )

  if (health.issues.length > 0) {
    lines.push('')
    lines.push('Issues:')
    for (const issue of health.issues) lines.push(`  - ${issue}`)
  }

  if (report.hotspots.length > 0) {
    lines.push('')
    lines.push('Most depended-on modules:')
    for (const hotspot of report.hotspots.slice(0, 5)) {
      lines.push(`  ${String(hotspot.fanIn).padStart(3)} ← ${hotspot.path}`)
    }
  }

  if (report.cycles.length > 0) {
    lines.push('')
    lines.push('Import cycles:')
    for (const cycle of report.cycles.slice(0, 5)) {
      lines.push(`  ${cycle.join(' → ')} → ${cycle[0] ?? ''}`)
    }
  }

  return lines.join('\n')
}
