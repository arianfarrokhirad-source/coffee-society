import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import {
  annotationsSchema,
  manifestSchema,
  type Annotations,
  type Manifest,
} from './manifest.schema.ts'

// Generates docs/codebase/MANIFEST.json and CATALOG.generated.md from the
// repository. Mechanical fields only — human judgement lives in
// annotations.json and is merged, never overwritten.
//   node tools/codebase/generate.ts

export const ROOT = resolve(import.meta.dirname, '../..')
const DOCS = join(ROOT, 'docs/codebase')

const rel = (p: string) => relative(ROOT, p).split('\\').join('/')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

function walk(dir: string, match: (p: string) => boolean, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, match, out)
    else if (match(full)) out.push(full)
  }
  return out
}

export function loadAnnotations(): Annotations {
  return annotationsSchema.parse(JSON.parse(read('tools/codebase/annotations.json')))
}

interface PackageJson {
  name?: string
  dependencies?: Record<string, string>
}

/** Public exports declared by a package entry point. */
function collectExports(packageDir: string): string[] {
  for (const entry of ['src/index.ts', 'src/index.tsx']) {
    let source: string
    try {
      source = readFileSync(join(packageDir, entry), 'utf8')
    } catch {
      continue
    }
    const names = new Set<string>()
    for (const m of source.matchAll(/export \* from '(.+?)'/g)) names.add(`* ${m[1]}`)
    for (const m of source.matchAll(/export \{([^}]+)\}/g)) {
      for (const name of m[1]!.split(',')) {
        const clean = name
          .trim()
          .replace(/^type /, '')
          .split(' as ')[0]!
          .trim()
        if (clean) names.add(clean)
      }
    }
    for (const m of source.matchAll(/export (?:async )?function (\w+)/g)) names.add(m[1]!)
    for (const m of source.matchAll(/export const (\w+)/g)) names.add(m[1]!)
    return [...names].sort()
  }
  return []
}

export function collectModules(annotations: Annotations): Manifest['modules'] {
  const dirs = [
    ...readdirSync(join(ROOT, 'packages')).map((d) => join(ROOT, 'packages', d)),
    join(ROOT, 'agents'),
    ...readdirSync(join(ROOT, 'apps')).map((d) => join(ROOT, 'apps', d)),
  ]
  const raw = dirs.flatMap((dir) => {
    let pkg: PackageJson
    try {
      pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as PackageJson
    } catch {
      return []
    }
    if (!pkg.name) return []
    const dependsOn = Object.keys(pkg.dependencies ?? {})
      .filter((d) => d.startsWith('@jarvis/'))
      .sort()
    const tests = walk(join(dir, 'tests'), (p) => p.endsWith('.test.ts'))
      .map(rel)
      .sort()
    return [{ name: pkg.name, path: rel(dir), exports: collectExports(dir), dependsOn, tests }]
  })

  return raw
    .map((m) => {
      const note = annotations.modules[m.name]
      return {
        ...m,
        consumers: raw
          .filter((other) => other.dependsOn.includes(m.name))
          .map((other) => other.name)
          .sort(),
        purpose: note?.purpose ?? 'UNANNOTATED — add to tools/codebase/annotations.json',
        securitySensitivity: note?.securitySensitivity ?? 'ordinary',
        stability: note?.stability ?? 'changing',
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function collectRoutes(): Manifest['routes'] {
  const appDir = join(ROOT, 'apps/command-center/app')
  return walk(appDir, (p) => /(page|route)\.tsx?$/.test(p))
    .map((p) => {
      const segments = relative(appDir, p).split(/[\\/]/)
      const kind = segments[segments.length - 1]!.startsWith('route') ? 'api' : 'page'
      const route = '/' + segments.slice(0, -1).join('/')
      return { route: route === '/' ? '/' : route, path: rel(p), kind: kind as 'page' | 'api' }
    })
    .sort((a, b) => a.route.localeCompare(b.route))
}

export function collectMigrations(): Manifest['databaseMigrations'] {
  return readdirSync(join(ROOT, 'supabase/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({
      path: `supabase/migrations/${f}`,
      sha256: createHash('sha256')
        .update(read(`supabase/migrations/${f}`))
        .digest('hex'),
    }))
}

export function collectInternalTools(): Manifest['internalTools'] {
  const path = 'packages/workflows/src/tools.ts'
  const source = read(path)
  const names = [...source.matchAll(/name: '(\w+)',\s*\n\s*description:/g)].map((m) => m[1]!)
  return [...new Set(names)].sort().map((name) => ({ name, path }))
}

/** Businesses and agents as declared in the seed — the canonical source. */
export function collectSeedDefinitions(): {
  businesses: Manifest['businesses']
  agents: Manifest['agents']
} {
  const seed = read('supabase/seed/seed.sql')
  const businesses = [...seed.matchAll(/\('(A\d{2})',\s*'([A-Z]+)',/g)]
    .map((m) => ({ code: m[1]!, name: m[2]! }))
    .filter((b, i, all) => all.findIndex((x) => x.code === b.code) === i)
    .sort((a, b) => a.code.localeCompare(b.code))
  const agents = [...seed.matchAll(/\('([A-Z]{3}-\d{2}|A\d{2}-[A-Z]{2,3})',\s*(null|'A\d{2}')/g)]
    .map((m) => ({ code: m[1]!, business: m[2] === 'null' ? null : m[2]!.replaceAll("'", '') }))
    .filter((a, i, all) => all.findIndex((x) => x.code === a.code) === i)
    .sort((a, b) => a.code.localeCompare(b.code))
  return { businesses, agents }
}

/** Same codes as declared in TypeScript — compared against the seed by verify. */
export function collectConstantDefinitions(): { businesses: string[]; agents: string[] } {
  const source = read('packages/shared/src/constants.ts')
  const section = (name: string) => {
    const block = source.split(`export const ${name} = [`)[1]?.split(']')[0] ?? ''
    return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]!).sort()
  }
  return { businesses: section('BUSINESS_CODES'), agents: section('AGENT_CODES') }
}

/**
 * Domain events discovered in code: `system_events` writes and audit
 * actions. Template-literal event names (e.g. `approval.${resolution}`) are
 * normalised to a `prefix.*` pattern and annotated once. Guarantees,
 * consumers and security class come from annotations — they cannot be
 * derived mechanically.
 */
export function collectDomainEvents(annotations: Annotations): Manifest['domainEvents'] {
  const sources = [
    ...walk(join(ROOT, 'packages'), (p) => p.endsWith('.ts') && !p.includes('/tests/')),
    ...walk(join(ROOT, 'apps'), (p) => p.endsWith('.ts') && !p.includes('/tests/')),
  ]
  const found = new Map<string, { kind: 'system_event' | 'audit_action'; producers: Set<string> }>()

  const record = (name: string, kind: 'system_event' | 'audit_action', file: string) => {
    const entry = found.get(name) ?? { kind, producers: new Set<string>() }
    entry.producers.add(file)
    found.set(name, entry)
  }

  // Event-shaped literal: dotted lowercase, e.g. task.created / agent.run.failed
  const EVENT_NAME = /^[a-z_]+(?:\.[a-z_]+)+$/
  /** Extract every event-shaped literal from an expression, so ternaries are covered. */
  const literalsIn = (expression: string): string[] =>
    [...expression.matchAll(/'([\w.]+)'/g)].map((m) => m[1]!).filter((v) => EVENT_NAME.test(v))

  for (const file of sources) {
    const source = readFileSync(file, 'utf8')
    const path = rel(file)
    // Property assignments, including multi-line ternaries (window of 3 lines).
    for (const m of source.matchAll(/(eventType|action):((?:[^\n]*\n?){0,3})/g)) {
      const kind = m[1] === 'eventType' ? 'system_event' : 'audit_action'
      for (const name of literalsIn(m[2]!)) record(name, kind, path)
      // Templates only on the property's own line, and only with a static
      // prefix — otherwise unrelated templates nearby (e.g. dedupeKey) match.
      for (const t of (m[2]!.split('\n')[0] ?? '').matchAll(/`([\w.]+?)\.?\$\{/g)) {
        record(`${t[1]!.replace(/\.$/, '')}.*`, kind, path)
      }
    }
    // Local audit helper calls, e.g. audit('objective.created', …)
    for (const m of source.matchAll(/\baudit\('([\w.]+)'/g)) {
      if (EVENT_NAME.test(m[1]!)) record(m[1]!, 'audit_action', path)
    }
  }

  // Audit actions written from SQL (migrations insert into audit_logs directly).
  for (const file of walk(join(ROOT, 'supabase/migrations'), (p) => p.endsWith('.sql'))) {
    const source = readFileSync(file, 'utf8')
    if (!source.includes('audit_logs')) continue
    for (const name of literalsIn(source)) record(name, 'audit_action', rel(file))
  }

  return [...found.entries()]
    .map(([name, entry]) => {
      const note = annotations.events[name]
      return {
        name,
        kind: entry.kind,
        producers: [...entry.producers].sort(),
        consumers: note?.consumers ?? [],
        guarantee: note?.guarantee ?? ('unknown' as const),
        securityClass: note?.securityClass ?? ('operational' as const),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function collectTests(): string[] {
  return [
    ...walk(join(ROOT, 'packages'), (p) => p.endsWith('.test.ts')),
    ...walk(join(ROOT, 'apps'), (p) => p.endsWith('.test.ts')),
    ...walk(join(ROOT, 'supabase/tests'), (p) => p.endsWith('.sql') || p.endsWith('.sh')),
  ]
    .map(rel)
    .sort()
}

export function repositoryCommit(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
}

export function buildManifest(annotations: Annotations, generatedAt: string): Manifest {
  const modules = collectModules(annotations)
  const { businesses, agents } = collectSeedDefinitions()
  return manifestSchema.parse({
    version: '1',
    generatedAt,
    repositoryCommit: repositoryCommit(),
    _generated: [
      'modules (except purpose/securitySensitivity/stability)',
      'databaseMigrations',
      'agents',
      'businesses',
      'routes',
      'internalTools',
      'tests',
      'dependencyGraph',
      'domainEvents (except consumers/guarantee/securityClass)',
      'repositoryCommit',
    ],
    modules,
    securityCriticalFiles: annotations.securityCriticalFiles,
    databaseMigrations: collectMigrations(),
    agents,
    businesses,
    routes: collectRoutes(),
    internalTools: collectInternalTools(),
    tests: collectTests(),
    dependencyGraph: modules.flatMap((m) => m.dependsOn.map((to) => ({ from: m.name, to }))),
    canonicalSources: annotations.canonicalSources,
    domainEvents: collectDomainEvents(annotations),
  })
}

export function buildEventCatalog(manifest: Manifest): string {
  const guarantee: Record<string, string> = {
    atomic: 'atomic with state change',
    best_effort: 'best effort',
    unknown: '**unannotated**',
  }
  const section = (kind: 'system_event' | 'audit_action', title: string, note: string) => {
    const rows = manifest.domainEvents.filter((e) => e.kind === kind)
    return [
      `## ${title}`,
      '',
      note,
      '',
      '| Event | Producers | Consumers | Delivery guarantee | Security class |',
      '| --- | --- | --- | --- | --- |',
      ...rows.map(
        (e) =>
          `| \`${e.name}\` | ${e.producers.map((p) => `\`${p}\``).join('<br>')} | ${
            e.consumers.length ? e.consumers.join(', ') : 'none — recorded only'
          } | ${guarantee[e.guarantee]} | ${e.securityClass.replace('_', '-')} |`
      ),
      '',
    ]
  }
  return [
    '<!-- GENERATED — do not edit by hand. Run: npm run codebase:generate -->',
    '',
    '# Event catalog (generated)',
    '',
    `Generated from commit \`${manifest.repositoryCommit.slice(0, 7)}\`. Event names and`,
    'producers are discovered in source; consumers, delivery guarantee and security',
    'class come from `tools/codebase/annotations.json` because they cannot be derived',
    'mechanically. `codebase:verify` fails when an event in code has no annotation.',
    '',
    'Payload shapes are not duplicated here — see the producing call site and the',
    '`system_events` / `audit_logs` columns in `supabase/migrations/0006_runs_audit.sql`.',
    '',
    ...section(
      'system_event',
      'System events',
      'Written to `system_events`. Idempotent via `dedupe_key`. **No consumer exists yet** — the table is a recording seam, not a queue.'
    ),
    ...section(
      'audit_action',
      'Audit actions',
      'Written to `audit_logs` (append-only). `atomic` means the row commits in the same transaction as its state change.'
    ),
  ].join('\n')
}

const short = (name: string) => name.replace('@jarvis/', '')

export function buildCatalog(manifest: Manifest): string {
  const lines: string[] = [
    '<!-- GENERATED — do not edit by hand. Run: npm run codebase:generate -->',
    '',
    '# Catalog (generated)',
    '',
    `Generated from commit \`${manifest.repositoryCommit.slice(0, 7)}\`. **Grep this file; do not read it whole.**`,
    'Purpose, security sensitivity and stability come from `tools/codebase/annotations.json`.',
    '',
    '## Modules',
    '',
    '| Module | Path | Sensitivity | Stability | Depends on | Consumers | Tests |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...manifest.modules.map(
      (m) =>
        `| \`${short(m.name)}\` | \`${m.path}\` | ${m.securitySensitivity} | ${m.stability} | ${m.dependsOn.map(short).join(', ') || '—'} | ${m.consumers.map(short).join(', ') || '—'} | ${m.tests.length} |`
    ),
    '',
    '## Dependency graph',
    '',
    '```mermaid',
    'graph LR',
    ...[...new Set(manifest.dependencyGraph.map((e) => `  ${short(e.from)} --> ${short(e.to)}`))],
    '```',
    '',
    '## Routes',
    '',
    '| Route | Kind | File |',
    '| --- | --- | --- |',
    ...manifest.routes.map((r) => `| \`${r.route}\` | ${r.kind} | \`${r.path}\` |`),
    '',
    '## Internal tools',
    '',
    manifest.internalTools.map((t) => `\`${t.name}\``).join(' · '),
    '',
    '## Businesses',
    '',
    manifest.businesses.map((b) => `\`${b.code}\` ${b.name}`).join(' · '),
    '',
    '## Agents',
    '',
    manifest.agents
      .map((a) => `\`${a.code}\`${a.business ? ` (${a.business})` : ' (org)'}`)
      .join(' · '),
    '',
    '## Migrations',
    '',
    ...manifest.databaseMigrations.map((m) => `- \`${m.path}\` — \`${m.sha256.slice(0, 12)}\``),
    '',
    '## Security-critical files',
    '',
    '| File | Class | Concern | Required tests |',
    '| --- | --- | --- | --- |',
    ...manifest.securityCriticalFiles.map(
      (f) =>
        `| \`${f.path}\` | ${f.class} | ${f.concern} | ${f.requiredTests.map((t) => `\`${t}\``).join('<br>')} |`
    ),
    '',
  ]
  return lines.join('\n')
}

function main(): void {
  const annotations = loadAnnotations()
  const manifest = buildManifest(annotations, new Date().toISOString())
  writeFileSync(join(DOCS, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n')
  writeFileSync(join(DOCS, 'CATALOG.generated.md'), buildCatalog(manifest))
  writeFileSync(join(DOCS, 'EVENT_CATALOG.generated.md'), buildEventCatalog(manifest))
  console.log(
    `generated MANIFEST.json + CATALOG.generated.md + EVENT_CATALOG.generated.md — ` +
      `${manifest.modules.length} modules, ${manifest.routes.length} routes, ` +
      `${manifest.internalTools.length} tools, ${manifest.databaseMigrations.length} migrations, ` +
      `${manifest.domainEvents.length} events, ${manifest.tests.length} test files`
  )
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) main()
