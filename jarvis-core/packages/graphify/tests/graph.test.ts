import { describe, expect, it } from 'vitest'
import { extractSymbols } from '@jarvis/ai'
import { adjacency, buildGraph, findCycles, normalisePath, resolveImport } from '../src/graph'
import { emptyIndexState, type IndexState } from '../src/types'

// The four graphs. These tests care most about the edges that should
// NOT exist: a graph that invents an edge sends a reader to code that
// never runs, which is worse than a graph that is merely incomplete.

/** Builds index state by running the real extractor over inline files. */
function stateFrom(files: Record<string, string>): IndexState {
  const state = emptyIndexState()
  for (const [path, content] of Object.entries(files)) {
    const { symbols, imports, calls } = extractSymbols({ path, content })
    state.files[path] = {
      path,
      hash: 'deadbeef',
      language: 'typescript',
      lineCount: content.split('\n').length,
      symbols,
      imports,
      calls,
      indexedAt: new Date().toISOString(),
    }
  }
  return state
}

describe('normalisePath', () => {
  it('collapses . and ..', () => {
    expect(normalisePath('a/./b')).toBe('a/b')
    expect(normalisePath('a/b/../c')).toBe('a/c')
    expect(normalisePath('a//b')).toBe('a/b')
  })

  it('does not let .. escape the root', () => {
    // Paths outside the repository are not addressable in this graph.
    expect(normalisePath('/a/../../b')).toBe('/b')
  })
})

describe('resolveImport', () => {
  const known = new Set(['src/a.ts', 'src/nested/index.ts', 'src/b.tsx'])

  it('resolves an exact relative path', () => {
    expect(resolveImport('src/main.ts', './a.ts', known)).toBe('src/a.ts')
  })

  it('resolves an extensionless import', () => {
    expect(resolveImport('src/main.ts', './a', known)).toBe('src/a.ts')
    expect(resolveImport('src/main.ts', './b', known)).toBe('src/b.tsx')
  })

  it('resolves a .js specifier to the .ts file on disk', () => {
    // ESM + NodeNext writes the compiled name in the import. Without
    // this every such edge would silently go missing.
    expect(resolveImport('src/main.ts', './a.js', known)).toBe('src/a.ts')
  })

  it('resolves a directory to its index file', () => {
    expect(resolveImport('src/main.ts', './nested', known)).toBe('src/nested/index.ts')
  })

  it('walks up with ..', () => {
    expect(resolveImport('src/deep/main.ts', '../a', known)).toBe('src/a.ts')
  })

  it('returns null for a package specifier', () => {
    expect(resolveImport('src/main.ts', 'zod', known)).toBeNull()
    expect(resolveImport('src/main.ts', '@jarvis/ai', known)).toBeNull()
  })

  it('returns null for a relative path that does not exist', () => {
    expect(resolveImport('src/main.ts', './missing', known)).toBeNull()
  })
})

describe('dependency graph', () => {
  it('draws an edge for a resolvable relative import', () => {
    const graph = buildGraph(
      stateFrom({
        'src/a.ts': 'import { b } from "./b"\nexport const a = 1',
        'src/b.ts': 'export const b = 2',
      })
    )
    const imports = graph.edges.filter((edge) => edge.kind === 'imports')
    expect(imports).toEqual([{ kind: 'imports', from: 'src/a.ts', to: 'src/b.ts' }])
  })

  it('counts a module imported on several lines once', () => {
    // One module is one dependency; counting it repeatedly distorts
    // every fan-in metric in the report.
    const graph = buildGraph(
      stateFrom({
        'src/a.ts': 'import { b } from "./b"\nimport type { T } from "./b"\nexport const a = 1',
        'src/b.ts': 'export const b = 2\nexport type T = string',
      })
    )
    expect(graph.edges.filter((edge) => edge.kind === 'imports')).toHaveLength(1)
  })

  it('records an external package rather than dropping it', () => {
    const graph = buildGraph(stateFrom({ 'src/a.ts': 'import { z } from "zod"' }))
    expect(graph.unresolved).toEqual([
      { from: 'src/a.ts', specifier: 'zod', line: 1, reason: 'external' },
    ])
  })

  it('distinguishes an asset import from genuine breakage', () => {
    // A permanently amber health signal is one people learn to ignore.
    const graph = buildGraph(
      stateFrom({ 'src/a.ts': 'import "./styles.css"\nimport "./missing-module"' })
    )
    expect(graph.unresolved.find((u) => u.specifier === './styles.css')?.reason).toBe('asset')
    expect(graph.unresolved.find((u) => u.specifier === './missing-module')?.reason).toBe(
      'unresolved'
    )
  })
})

describe('symbol graph', () => {
  it('declares a node per symbol, addressed as path#name', () => {
    const graph = buildGraph(stateFrom({ 'src/a.ts': 'export function alpha() {}' }))
    const symbol = graph.nodes.find((node) => node.kind === 'symbol')
    expect(symbol?.id).toBe('src/a.ts#alpha')
    expect(graph.edges).toContainEqual({
      kind: 'declares',
      from: 'src/a.ts',
      to: 'src/a.ts#alpha',
    })
  })

  it('records whether a symbol is exported', () => {
    const graph = buildGraph(
      stateFrom({ 'src/a.ts': 'export function pub() {}\nfunction priv() {}' })
    )
    const symbols = graph.nodes.filter((node) => node.kind === 'symbol')
    expect(symbols.map((s) => s.kind === 'symbol' && s.exported)).toEqual([true, false])
  })
})

describe('function/call graph', () => {
  it('draws an edge only when a name is both imported and called', () => {
    const graph = buildGraph(
      stateFrom({
        'src/a.ts': [
          'import { helper } from "./b"',
          'export function run() {',
          '  helper()',
          '}',
        ].join('\n'),
        'src/b.ts': 'export function helper() {}',
      })
    )
    expect(graph.edges).toContainEqual({
      kind: 'calls',
      from: 'src/a.ts#run',
      to: 'src/b.ts#helper',
    })
  })

  it('does not invent an edge for an import that is never called', () => {
    // The trap: requiring only the import yields the cartesian product
    // of every symbol against every import — dense, and meaningless.
    const graph = buildGraph(
      stateFrom({
        'src/a.ts': 'import type { Thing } from "./b"\nexport function run() {}',
        'src/b.ts': 'export type Thing = string\nexport function unused() {}',
      })
    )
    expect(graph.edges.filter((edge) => edge.kind === 'calls')).toEqual([])
  })

  it('does not explode edge count with unrelated symbols', () => {
    const graph = buildGraph(
      stateFrom({
        'src/a.ts': [
          'import { one } from "./b"',
          'export function x() { one() }',
          'export function y() {}',
          'export function z() {}',
        ].join('\n'),
        'src/b.ts':
          'export function one() {}\nexport function two() {}\nexport function three() {}',
      })
    )
    // One real call site, not 3 symbols x 3 exports.
    expect(graph.edges.filter((edge) => edge.kind === 'calls')).toHaveLength(1)
  })

  it('ignores control-flow keywords', () => {
    const graph = buildGraph(
      stateFrom({
        'src/a.ts': [
          'import { helper } from "./b"',
          'export function run() {',
          '  if (helper) { return helper() }',
          '  for (const x of []) {}',
          '}',
        ].join('\n'),
        'src/b.ts': 'export function helper() {}',
      })
    )
    const calls = graph.edges.filter((edge) => edge.kind === 'calls')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.to).toBe('src/b.ts#helper')
  })

  it('attributes a module-scope call to the file, not to a symbol', () => {
    // Module initialisation is a real edge; dropping it hides work that
    // happens on import.
    const graph = buildGraph(
      stateFrom({
        'src/a.ts': 'import { init } from "./b"\ninit()',
        'src/b.ts': 'export function init() {}',
      })
    )
    expect(graph.edges).toContainEqual({ kind: 'calls', from: 'src/a.ts', to: 'src/b.ts#init' })
  })

  it('does not draw an edge when a local declaration shadows the import', () => {
    const graph = buildGraph(
      stateFrom({
        'src/a.ts': [
          'import { helper } from "./b"',
          'function helper() {}',
          'export function run() { helper() }',
        ].join('\n'),
        'src/b.ts': 'export function helper() {}',
      })
    )
    expect(graph.edges.filter((edge) => edge.kind === 'calls')).toEqual([])
  })
})

describe('findCycles', () => {
  it('finds a two-module cycle', () => {
    const graph = buildGraph(
      stateFrom({
        'src/a.ts': 'import { b } from "./b"\nexport const a = 1',
        'src/b.ts': 'import { a } from "./a"\nexport const b = 2',
      })
    )
    const cycles = findCycles(graph)
    expect(cycles).toHaveLength(1)
    expect(cycles[0]?.sort()).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('reports the same cycle once regardless of entry point', () => {
    const graph = buildGraph(
      stateFrom({
        'src/a.ts': 'import { b } from "./b"\nexport const a = 1',
        'src/b.ts': 'import { c } from "./c"\nexport const b = 1',
        'src/c.ts': 'import { a } from "./a"\nexport const c = 1',
      })
    )
    expect(findCycles(graph)).toHaveLength(1)
  })

  it('reports nothing for an acyclic graph', () => {
    const graph = buildGraph(
      stateFrom({
        'src/a.ts': 'import { b } from "./b"\nexport const a = 1',
        'src/b.ts': 'export const b = 2',
      })
    )
    expect(findCycles(graph)).toEqual([])
  })

  it('handles a deep chain without exhausting the call stack', () => {
    // Recursion here would crash indexing on a large repository, and it
    // would arrive as an unexplained stack overflow rather than a graph
    // problem.
    const files: Record<string, string> = {}
    for (let i = 0; i < 3_000; i += 1) {
      files[`src/f${i}.ts`] =
        i === 2_999 ? 'export const x = 1' : `import { x } from "./f${i + 1}"\nexport const x = 1`
    }
    expect(() => findCycles(buildGraph(stateFrom(files)))).not.toThrow()
  })
})

describe('adjacency', () => {
  it('groups edges of one kind by source', () => {
    const graph = buildGraph(
      stateFrom({
        'src/a.ts': 'import { b } from "./b"\nimport { c } from "./c"\nexport const a = 1',
        'src/b.ts': 'export const b = 1',
        'src/c.ts': 'export const c = 1',
      })
    )
    expect(adjacency(graph, 'imports').get('src/a.ts')?.sort()).toEqual(['src/b.ts', 'src/c.ts'])
  })
})
