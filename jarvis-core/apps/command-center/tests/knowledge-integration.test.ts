import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The integration contract, and the only thing it really promises: the
// knowledge layer is supporting context, not the product. A missing
// vault or a missing code index must degrade to an empty panel and must
// never take down the page — customer-facing workflows share it.

const { readGraph, readVault } = await import('@/lib/knowledge')

let workspace: string
const originalVault = process.env.JARVIS_VAULT_PATH
const originalGraph = process.env.JARVIS_GRAPH_INDEX

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'jarvis-knowledge-'))
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
  if (originalVault === undefined) delete process.env.JARVIS_VAULT_PATH
  else process.env.JARVIS_VAULT_PATH = originalVault
  if (originalGraph === undefined) delete process.env.JARVIS_GRAPH_INDEX
  else process.env.JARVIS_GRAPH_INDEX = originalGraph
})

describe('vault integration', () => {
  it('reports unavailable rather than throwing when the vault is absent', async () => {
    process.env.JARVIS_VAULT_PATH = join(workspace, 'does-not-exist')
    const snapshot = await readVault()
    expect(snapshot.available).toBe(false)
    expect(snapshot.notes).toEqual([])
  })

  it('reads notes and counts them by type', async () => {
    const vault = join(workspace, 'vault')
    await mkdir(join(vault, '10-decisions'), { recursive: true })
    await writeFile(
      join(vault, '10-decisions', 'ADR-0001-x.md'),
      '---\ntype: adr\nid: ADR-0001\ntitle: A decision\nstatus: accepted\n---\n\nBecause mtime lies.\n'
    )
    await writeFile(
      join(vault, '10-decisions', 'note.md'),
      '---\ntype: ceo\ntitle: Priorities\n---\n\nShip by August.\n'
    )
    process.env.JARVIS_VAULT_PATH = vault

    const snapshot = await readVault()
    expect(snapshot.available).toBe(true)
    expect(snapshot.notes).toHaveLength(2)
    expect(snapshot.countsByType).toEqual({ adr: 1, ceo: 1 })
  })

  it('searches only when the term is long enough to be meaningful', async () => {
    const vault = join(workspace, 'vault')
    await mkdir(vault, { recursive: true })
    await writeFile(
      join(vault, 'a.md'),
      '---\ntype: adr\nid: ADR-0001\ntitle: Hashing\n---\n\nBecause mtime lies.\n'
    )
    process.env.JARVIS_VAULT_PATH = vault

    expect((await readVault('mtime')).hits).toHaveLength(1)
    // A one-character term matches everything and is not a search.
    expect((await readVault('m')).hits).toHaveLength(0)
    expect((await readVault()).hits).toHaveLength(0)
  })

  it('ignores a note with no frontmatter rather than failing the panel', async () => {
    const vault = join(workspace, 'vault')
    await mkdir(vault, { recursive: true })
    await writeFile(join(vault, 'broken.md'), '# no frontmatter')
    await writeFile(join(vault, 'ok.md'), '---\ntype: sop\ntitle: Fine\n---\n\nSteps.\n')
    process.env.JARVIS_VAULT_PATH = vault

    const snapshot = await readVault()
    expect(snapshot.available).toBe(true)
    expect(snapshot.notes).toHaveLength(1)
  })
})

describe('graph integration', () => {
  it('reports unavailable when no index exists', async () => {
    // Expected in a deployment: the index is derived data and is not
    // committed. Absence is not a fault.
    process.env.JARVIS_GRAPH_INDEX = join(workspace, 'missing.json')
    const snapshot = await readGraph()
    expect(snapshot.available).toBe(false)
    expect(snapshot.report).toBeNull()
    expect(snapshot.health).toBeNull()
  })

  it('reports unavailable for a corrupt index rather than throwing', async () => {
    const path = join(workspace, 'index.json')
    await writeFile(path, 'not json at all')
    process.env.JARVIS_GRAPH_INDEX = path

    const snapshot = await readGraph()
    expect(snapshot.available).toBe(false)
  })

  it('reports unavailable for an index with no files', async () => {
    const path = join(workspace, 'index.json')
    await writeFile(
      path,
      JSON.stringify({ version: 2, inProgress: false, lastCompletedAt: null, files: {} })
    )
    process.env.JARVIS_GRAPH_INDEX = path

    expect((await readGraph()).available).toBe(false)
  })

  it('builds a report and health from a real index', async () => {
    const path = join(workspace, 'index.json')
    await writeFile(
      path,
      JSON.stringify({
        version: 2,
        inProgress: false,
        lastCompletedAt: new Date().toISOString(),
        files: {
          'src/a.ts': {
            path: 'src/a.ts',
            hash: 'aaaaaaaa',
            language: 'typescript',
            lineCount: 2,
            symbols: [{ name: 'a', kind: 'function', exported: true, line: 2 }],
            imports: [{ specifier: './b', relative: true, line: 1 }],
            calls: [],
            indexedAt: new Date().toISOString(),
          },
          'src/b.ts': {
            path: 'src/b.ts',
            hash: 'bbbbbbbb',
            language: 'typescript',
            lineCount: 1,
            symbols: [{ name: 'b', kind: 'function', exported: true, line: 1 }],
            imports: [],
            calls: [],
            indexedAt: new Date().toISOString(),
          },
        },
      })
    )
    process.env.JARVIS_GRAPH_INDEX = path

    const snapshot = await readGraph()
    expect(snapshot.available).toBe(true)
    expect(snapshot.report?.totals.files).toBe(2)
    expect(snapshot.report?.totals.importEdges).toBe(1)
    expect(snapshot.health?.status).toBe('healthy')
  })
})
