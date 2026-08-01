import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { manifestSchema, type Manifest } from './manifest.schema.ts'
import {
  ROOT,
  buildCatalog,
  buildManifest,
  collectConstantDefinitions,
  collectSeedDefinitions,
  loadAnnotations,
} from './generate.ts'

// Mechanical checks over the knowledge system. Advisory by default (exit 0);
// pass --strict to exit non-zero. Slice 3 makes --strict the default and
// wires it into `npm run validate`.
//
// This verifies structure, not truth: a green run means paths resolve and
// generated content is fresh, NOT that the prose is accurate.

const failures: string[] = []
const notes: string[] = []
const fail = (check: string, detail: string) => failures.push(`${check}: ${detail}`)

const DOCS = join(ROOT, 'docs/codebase')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const exists = (p: string) => existsSync(join(ROOT, p))

function loadManifest(): Manifest | null {
  try {
    return manifestSchema.parse(JSON.parse(read('docs/codebase/MANIFEST.json')))
  } catch (error) {
    fail('manifest', `unreadable or schema-invalid — ${(error as Error).message.slice(0, 200)}`)
    return null
  }
}

function checkPaths(manifest: Manifest): void {
  const missing: string[] = []
  const check = (p: string) => {
    if (!exists(p)) missing.push(p)
  }
  manifest.modules.forEach((m) => {
    check(m.path)
    m.tests.forEach(check)
  })
  manifest.securityCriticalFiles.forEach((f) => {
    check(f.path)
    f.requiredTests.forEach(check)
  })
  manifest.databaseMigrations.forEach((m) => check(m.path))
  manifest.routes.forEach((r) => check(r.path))
  manifest.internalTools.forEach((t) => check(t.path))
  manifest.tests.forEach(check)
  if (missing.length)
    fail('paths', `${missing.length} referenced path(s) missing: ${missing.join(', ')}`)
}

function checkRequiredTestsNonEmpty(manifest: Manifest): void {
  const empty = manifest.securityCriticalFiles.filter((f) => f.requiredTests.length === 0)
  if (empty.length)
    fail('security-tests', `no required tests: ${empty.map((f) => f.path).join(', ')}`)
}

function checkStaleness(manifest: Manifest): void {
  const regenerated = buildManifest(loadAnnotations(), manifest.generatedAt)
  const strip = (m: Manifest) => JSON.stringify({ ...m, generatedAt: '', repositoryCommit: '' })
  if (strip(regenerated) !== strip(manifest)) {
    fail('staleness', 'MANIFEST.json is out of date — run `npm run codebase:generate`')
  }
  const catalog = join(DOCS, 'CATALOG.generated.md')
  if (!existsSync(catalog)) fail('staleness', 'CATALOG.generated.md missing')
  else if (readFileSync(catalog, 'utf8') !== buildCatalog(manifest)) {
    fail('staleness', 'CATALOG.generated.md is out of date — run `npm run codebase:generate`')
  }
}

function checkSecurityCoverage(manifest: Manifest): void {
  const patterns = loadAnnotations().securityPathPatterns
  const classified = new Set(manifest.securityCriticalFiles.map((f) => f.path))
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(join(ROOT, dir))) {
      if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue
      const p = `${dir}/${entry}`
      if (statSync(join(ROOT, p)).isDirectory()) walk(p, out)
      // Barrel files (src/index.ts) only re-export; they hold no logic to classify.
      else if (/\.(ts|tsx|sql)$/.test(p) && !p.includes('/tests/') && !p.endsWith('/src/index.ts'))
        out.push(p)
    }
    return out
  }
  const unclassified = [
    ...walk('packages'),
    ...walk('apps'),
    ...walk('supabase/migrations'),
  ].filter((p) => patterns.some((pattern) => p.includes(pattern)) && !classified.has(p))
  if (unclassified.length) {
    fail(
      'security-coverage',
      `security-shaped file(s) not classified in annotations.json: ${unclassified.join(', ')}`
    )
  }
}

function checkDependencyRules(manifest: Manifest): void {
  const rules = loadAnnotations().layerRules
  for (const module of manifest.modules) {
    const allowed = rules[module.name]
    if (!allowed) {
      fail('layering', `${module.name} has no layerRules entry`)
      continue
    }
    const forbidden = module.dependsOn.filter((d) => !allowed.includes(d))
    if (forbidden.length) {
      fail('layering', `${module.name} must not depend on ${forbidden.join(', ')}`)
    }
  }
}

function checkDefinitionDrift(): void {
  const seed = collectSeedDefinitions()
  const constants = collectConstantDefinitions()
  const seedBusinesses = seed.businesses.map((b) => b.code)
  const seedAgents = seed.agents.map((a) => a.code)
  if (JSON.stringify(seedBusinesses) !== JSON.stringify(constants.businesses)) {
    fail(
      'drift',
      `business codes differ — seed [${seedBusinesses}] vs constants [${constants.businesses}]`
    )
  }
  if (JSON.stringify(seedAgents) !== JSON.stringify(constants.agents)) {
    fail('drift', `agent codes differ — seed [${seedAgents}] vs constants [${constants.agents}]`)
  }
}

function checkDocLinksAndBudgets(): void {
  const budgets: Record<string, number> = { context: 200, default: 400 }
  const docs = readdirSync(DOCS, { recursive: true, encoding: 'utf8' }).filter((f) =>
    f.endsWith('.md')
  )
  for (const doc of docs) {
    const full = join(DOCS, doc)
    const body = readFileSync(full, 'utf8')
    const lines = body.split('\n').length
    const budget = doc.includes('context') ? budgets.context! : budgets.default!
    if (lines > budget) fail('budget', `${doc} is ${lines} lines (budget ${budget})`)
    for (const match of body.matchAll(/\]\(((?:\.\.?\/)?[\w./-]+\.md)\)/g)) {
      const target = resolve(join(DOCS, doc, '..'), match[1]!)
      if (!existsSync(target)) fail('links', `${doc} -> ${match[1]} does not resolve`)
    }
  }
}

function checkNoSecrets(): void {
  const pattern =
    /(sk-[A-Za-z0-9_-]{20,}|whsec_[A-Za-z0-9]{10,}|AKIA[0-9A-Z]{16}|eyJhbGciOi[\w-]{15,})/
  const docs = readdirSync(DOCS, { recursive: true, encoding: 'utf8' }).filter((f) =>
    f.endsWith('.md')
  )
  for (const doc of docs) {
    const hit = readFileSync(join(DOCS, doc), 'utf8').match(pattern)
    if (hit) fail('secrets', `${doc} contains a secret-shaped string: ${hit[0].slice(0, 12)}…`)
  }
}

function checkEvolutionTriggers(): void {
  const path = 'docs/codebase/ARCHITECTURE_EVOLUTION.md'
  if (!exists(path)) {
    fail('evolution', 'ARCHITECTURE_EVOLUTION.md is missing')
    return
  }
  const rows = read(path)
    .split('\n')
    .filter((l) => l.startsWith('| ') && !l.startsWith('| ---') && !l.includes('Current choice'))
  const incomplete = rows.filter((row) => {
    const cells = row.split('|').map((c) => c.trim())
    // | choice | why acceptable | trigger | candidate | cost | dependencies |
    return cells.length < 7 || cells.slice(1, 7).some((c) => c === '' || c === '—' || c === 'TBD')
  })
  if (incomplete.length) {
    fail(
      'evolution',
      `${incomplete.length} row(s) missing a trigger, candidate, cost or dependency`
    )
  }
  notes.push(`evolution: ${rows.length} tracked temporary decisions`)
}

function checkCurrentStateCommit(): void {
  const body = read('docs/codebase/CURRENT_STATE.md')
  for (const match of body.matchAll(/`([0-9a-f]{7,40})`/g)) {
    try {
      execFileSync('git', ['cat-file', '-e', `${match[1]}^{commit}`], {
        cwd: ROOT,
        stdio: 'ignore',
      })
    } catch {
      notes.push(`current-state: \`${match[1]}\` is not a commit in this repository (warning only)`)
    }
  }
}

function main(): void {
  const strict = process.argv.includes('--strict')
  const manifest = loadManifest()
  if (manifest) {
    checkPaths(manifest)
    checkRequiredTestsNonEmpty(manifest)
    checkStaleness(manifest)
    checkSecurityCoverage(manifest)
    checkDependencyRules(manifest)
  }
  checkDefinitionDrift()
  checkDocLinksAndBudgets()
  checkNoSecrets()
  checkEvolutionTriggers()
  checkCurrentStateCommit()

  notes.forEach((n) => console.log(`note   ${n}`))
  if (failures.length === 0) {
    console.log('codebase:verify — all checks passed')
    return
  }
  console.error(`\ncodebase:verify — ${failures.length} FAILURE(S)`)
  failures.forEach((f) => console.error(`  FAIL  ${f}`))
  if (strict) process.exitCode = 1
  else console.error('\n(advisory mode — not blocking. Run with --strict to fail the build.)')
}

main()
