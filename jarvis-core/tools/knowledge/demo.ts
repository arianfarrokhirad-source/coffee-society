import { resolve } from 'node:path'
import {
  createAnthropicProvider,
  createEmbeddingClient,
  createGeminiProvider,
  createOpenAIProvider,
  createRouter,
} from '@jarvis/ai'
import {
  buildReport,
  createFileStateStore,
  loadState,
  runIndex,
  walkRepository,
} from '@jarvis/graphify'
import { createVault, createVaultFs } from '@jarvis/obsidian'

// Demonstration that the three layers answer different questions about
// the same subject, and that the answers compose.
//
// The question: "Why does Graphify use content hashes instead of
// modification times?"
//
//   Graphify answers WHERE — which modules implement it, what depends
//     on them. Derived from the repository, rebuilt in ~100ms.
//   Obsidian answers WHY — the decision, its alternatives, its costs.
//     Authored by a human; nothing else can reconstruct it.
//   Gemini is the PROCESSING ENGINE — it resolves as the provider for
//     extraction work, which is the routing that took that class of
//     work off Claude.
//
// Runs entirely offline. No API key, no network, no spend. Where a
// credential would be needed, it reports what WOULD happen rather than
// pretending it happened.

const ROOT = resolve(import.meta.dirname, '../..')
const QUESTION = 'content hash mtime change detection'

function heading(text: string): void {
  console.log(`\n${'─'.repeat(68)}\n${text}\n${'─'.repeat(68)}`)
}

async function main(): Promise<void> {
  console.log('JARVIS Knowledge Layer — integrated demonstration')
  console.log(`Question: "Why does Graphify use content hashes, not mtime?"`)

  // --- Graphify: where -------------------------------------------------
  heading('GRAPHIFY — code memory (what and where)')

  const store = createFileStateStore(resolve(ROOT, '.graphify-index.json'))
  const observed = await walkRepository(ROOT)
  const run = await runIndex(store, observed)
  if (!run.ok) {
    console.error(run.error)
    process.exitCode = 1
    return
  }

  const graph = run.value.graph
  const report = buildReport(graph)
  console.log(
    `Indexed ${report.totals.files} files, ${report.totals.symbols} symbols ` +
      `(${run.value.noOp ? 'no changes' : `${run.value.extracted} re-extracted`}) ` +
      `in ${run.value.durationMs}ms, zero AI calls.`
  )

  // Which module implements change detection, and what would break.
  const target = 'packages/graphify/src/state.ts'
  const symbols = graph.nodes.filter((node) => node.kind === 'symbol' && node.file === target)
  const dependents = graph.edges
    .filter((edge) => edge.kind === 'imports' && edge.to === target)
    .map((edge) => edge.from)

  console.log(`\nImplemented in: ${target}`)
  console.log(
    `  Exports: ${symbols
      .filter((node) => node.kind === 'symbol' && node.exported)
      .map((node) => (node.kind === 'symbol' ? node.name : ''))
      .join(', ')}`
  )
  console.log(`  Changing it affects: ${dependents.join(', ') || '(nothing yet)'}`)

  // --- Obsidian: why ---------------------------------------------------
  heading('OBSIDIAN — business brain (why)')

  const vault = createVault(createVaultFs(resolve(ROOT, 'farrokhirad-vault')))
  const hits = await vault.search(QUESTION)

  if (hits.length === 0) {
    console.log('No note answers this. That is itself a finding — the decision is undocumented.')
  } else {
    for (const hit of hits.slice(0, 2)) {
      const { frontmatter, path } = hit.note
      // Provenance on every result so the caller can judge freshness.
      console.log(
        `${String(frontmatter.id ?? frontmatter.title)} — ${String(frontmatter.title)}\n` +
          `  ${path} [${frontmatter.type}, ${String(frontmatter.status ?? 'n/a')}, ${String(frontmatter.date ?? 'undated')}]`
      )
      const alternatives = hit.note.body.split('## Alternatives considered')[1]
      if (alternatives) {
        console.log(`  Rejected: ${alternatives.trim().split('\n')[0]}`)
      }
    }
  }

  const backlinks = await vault.backlinks('ADR-0002')
  console.log(`\nOperational procedures citing this decision: ${backlinks.length}`)
  for (const note of backlinks) console.log(`  ${note.path}`)

  // --- Gemini: the processing engine -----------------------------------
  heading('GEMINI — processing engine (routing)')

  const providers = [createAnthropicProvider(), createOpenAIProvider(), createGeminiProvider()]
  const configured = providers.filter((provider) => provider.isConfigured())
  const router = createRouter(providers)
  const embeddings = createEmbeddingClient(providers)

  console.log(
    `Configured providers: ${configured.map((p) => p.name).join(', ') || '(none in this environment)'}`
  )

  for (const kind of ['extraction', 'document', 'executive', 'review'] as const) {
    const route = router.resolveRoute(kind)
    console.log(
      `  ${kind.padEnd(11)} → ${
        route.ok
          ? `${route.value.provider} (${route.value.model})` +
            (route.value.chain.length > 1
              ? `, falls back to ${route.value.chain
                  .slice(1)
                  .map((entry) => entry.provider)
                  .join(' → ')}`
              : '')
          : 'unroutable — no credential'
      }`
    )
  }

  const embeddingRoute = embeddings.resolveRoute()
  console.log(
    `  embeddings  → ${embeddingRoute.ok ? `${embeddingRoute.value.provider} (${embeddingRoute.value.model})` : 'unroutable — no credential'}`
  )

  // --- Composition ------------------------------------------------------
  heading('COMPOSED ANSWER')

  const decision = hits[0]?.note
  console.log(
    [
      `WHERE  ${target} — ${symbols.length} symbols, ${dependents.length} dependent module(s).`,
      `WHY    ${decision ? `${String(decision.frontmatter.id)}: ${String(decision.frontmatter.title)}` : 'undocumented'}`,
      `HOW    ${backlinks.length} SOP(s) operationalise it.`,
      `ENGINE extraction routes to ${router.resolveRoute('extraction').ok ? (router.resolveRoute('extraction') as { value: { provider: string } }).value.provider : 'no configured provider'}.`,
      '',
      'Graphify rebuilt its half from the repository in milliseconds.',
      'Obsidian’s half could not be rebuilt from anything — it exists',
      'only because a person wrote it down. That asymmetry is why there',
      'are two stores and not one.',
    ].join('\n')
  )

  const loaded = await loadState(store)
  console.log(
    `\nIndex: ${Object.keys(loaded.state.files).length} files, last completed ${String(loaded.state.lastCompletedAt)}`
  )
}

main().catch((cause: unknown) => {
  console.error(cause instanceof Error ? cause.message : cause)
  process.exitCode = 1
})
