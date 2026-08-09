import { resolve } from 'node:path'
import {
  assessHealth,
  buildGraph,
  buildReport,
  createFileStateStore,
  formatReport,
  loadState,
  runIndex,
  walkRepository,
} from '@jarvis/graphify'

// CLI entry point for Graphify.
//
// Structural indexing only by default: no API key, no network, no spend.
// The semantic pass is a separate, opt-in concern precisely because it
// is the expensive one — a developer running this a hundred times a day
// must not be billed for it.
//
//   npm run graph          incremental run
//   npm run graph -- --force   full re-extract
//   npm run graph:health       report only
//
// Run through tsx rather than node's own type stripping: the workspace
// packages import without file extensions, which node's ESM resolver
// does not accept.

const ROOT = resolve(import.meta.dirname, '../..')
const STATE_PATH = resolve(ROOT, '.graphify-index.json')

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2))
  const store = createFileStateStore(STATE_PATH)

  if (args.has('--health')) {
    const loaded = await loadState(store)
    const report = buildReport(buildGraph(loaded.state))
    console.log(formatReport(report, assessHealth(loaded.state, report)))
    return
  }

  const started = Date.now()
  const observed = await walkRepository(ROOT)
  const walkMs = Date.now() - started

  const result = await runIndex(store, observed, { force: args.has('--force') })
  if (!result.ok) {
    console.error(result.error)
    process.exitCode = 1
    return
  }

  const { changes, graph, extracted, noOp, recoveredFromCrash, discardedState } = result.value

  if (recoveredFromCrash) console.log('Recovered from an incomplete previous run.')
  if (discardedState) console.log(`Previous index discarded: ${discardedState}.`)

  console.log(
    noOp
      ? `No changes. ${observed.length} files scanned in ${walkMs}ms; nothing re-extracted.`
      : `+${changes.added.length} ~${changes.modified.length} -${changes.deleted.length} ` +
          `(${changes.unchanged.length} unchanged) · extracted ${extracted} · ` +
          `${result.value.durationMs}ms`
  )

  const report = buildReport(graph)
  const loaded = await loadState(store)
  const health = assessHealth(loaded.state, report)
  console.log('')
  console.log(formatReport(report, health))

  // --strict is for CI. Staleness is deliberately NOT a failure here:
  // the run that just completed is by definition fresh, and failing on
  // age would make the check depend on the clock rather than the code.
  // Structural defects — imports that resolve to nothing, import cycles
  // — are the repository's problem and do fail the build.
  if (args.has('--strict')) {
    const fatal: string[] = []
    if (report.brokenImports.length > 0) {
      fatal.push(
        `${report.brokenImports.length} broken relative import(s): ` +
          report.brokenImports
            .map((entry) => `${entry.from}:${entry.line} ${entry.specifier}`)
            .join(', ')
      )
    }
    if (report.cycles.length > 0) {
      fatal.push(
        `${report.cycles.length} import cycle(s): ` +
          report.cycles.map((c) => c.join(' → ')).join(' | ')
      )
    }
    if (fatal.length > 0) {
      console.error('')
      for (const line of fatal) console.error(`FAIL: ${line}`)
      process.exitCode = 1
    }
  }
}

// Not top-level await: the repository root is CommonJS, and a
// top-level await forces an ESM-only output the tool runner rejects.
main().catch((cause: unknown) => {
  console.error(cause instanceof Error ? cause.message : cause)
  process.exitCode = 1
})
