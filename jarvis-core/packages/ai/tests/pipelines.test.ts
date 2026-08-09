import { describe, expect, it, vi } from 'vitest'
import { err, ok } from '@jarvis/shared'
import { createEmbeddingClient } from '../src/embeddings'
import { processDocument } from '../src/pipelines/document'
import {
  contentHash,
  extractRepository,
  extractSymbols,
  inferLanguage,
} from '../src/pipelines/repository'
import type { AIRouter } from '../src/router'
import type { AIProvider, EmbeddingRequest, EmbeddingResponse } from '../src/types'

// The pipelines are where Gemini actually takes work off Claude. The
// properties pinned here are the ones that decide whether the output is
// trustworthy: partial failure stays visible, and the parser — not the
// model — owns the facts that syntax already contains.

/** A router that answers with canned JSON, so no network is involved. */
function fakeRouter(options?: {
  reply?: (prompt: string) => unknown
  fail?: string
  failFor?: (prompt: string) => boolean
}): AIRouter {
  return {
    resolveRoute: () =>
      ok({
        kind: 'extraction',
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        fallback: null,
        chain: [],
      }),
    availableProviders: () => ['gemini'],
    completeWithStats: async () => err('not used'),
    async complete(_kind, request) {
      const prompt = request.messages.map((m) => m.content).join('\n')
      if (options?.fail) return err(options.fail)
      if (options?.failFor?.(prompt)) return err('extraction refused')
      const payload = options?.reply?.(prompt) ?? {
        summary: 'A summary.',
        topics: ['pricing'],
        entities: ['Acme'],
        actions: [],
      }
      return ok({
        text: JSON.stringify(payload),
        model: 'gemini-2.5-flash',
        provider: 'gemini' as const,
        usage: { inputTokens: 10, outputTokens: 5 },
        latencyMs: 1,
      })
    },
  }
}

function fakeEmbeddings(onEmbed?: (r: EmbeddingRequest) => void) {
  const provider: AIProvider = {
    name: 'gemini',
    isConfigured: () => true,
    maxEmbeddingBatch: 100,
    complete: async () => {
      throw new Error('not used')
    },
    async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
      onEmbed?.(request)
      return {
        provider: 'gemini',
        model: request.model,
        vectors: request.inputs.map((_, index) => ({ index, values: [index + 1, 1, 1] })),
        usage: null,
        latencyMs: 1,
        dimensions: 3,
      }
    },
  }
  return createEmbeddingClient([provider], { models: { gemini: 'gemini-embedding-001' } })
}

const LONG_DOC = [
  'The client wants a rebuild before Christmas.',
  'Acme Joinery currently pays 400 EUR per month for hosting.',
  'The maintenance plan should cover security updates and backups.',
]
  .map((line) => line.repeat(40))
  .join('\n\n')

describe('processDocument', () => {
  it('refuses a document with no extractable text', async () => {
    const result = await processDocument({ id: 'd1', title: 'Empty', text: '   ' })
    expect(result.ok).toBe(false)
  })

  it('chunks without a model when neither router nor embeddings are supplied', async () => {
    // Chunking is free and offline. A caller that only wants chunks must
    // not be billed for a model call.
    const result = await processDocument({ id: 'd1', title: 'Notes', text: LONG_DOC })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.chunks.length).toBeGreaterThan(1)
      expect(result.value.stats.extracted).toBe(0)
      expect(result.value.stats.embedded).toBe(0)
    }
  })

  it('routes extraction through the extraction route', async () => {
    const router = fakeRouter()
    const spy = vi.spyOn(router, 'complete')
    await processDocument({ id: 'd1', title: 'Notes', text: LONG_DOC }, { router })
    // ROUTE_PREFERENCE leads 'extraction' with Gemini — this is the
    // concrete point where Gemini takes over from Claude.
    expect(spy.mock.calls.every(([kind]) => kind === 'extraction')).toBe(true)
  })

  it('merges topics and entities across chunks without duplicates', async () => {
    const router = fakeRouter({
      reply: () => ({
        summary: 's',
        topics: ['Pricing', 'pricing', 'Hosting'],
        entities: ['Acme'],
        actions: ['Send quote'],
      }),
    })

    const result = await processDocument({ id: 'd1', title: 'Notes', text: LONG_DOC }, { router })
    expect(result.ok).toBe(true)
    if (result.ok) {
      // Case-insensitive dedupe, first-seen casing preserved.
      expect(result.value.topics).toEqual(['Pricing', 'Hosting'])
      expect(result.value.entities).toEqual(['Acme'])
    }
  })

  it('keeps a chunk that failed extraction instead of dropping it', async () => {
    // Dropping it would make the document silently incomplete in search
    // while the call still reported success.
    const router = fakeRouter({ failFor: (prompt) => prompt.includes('Excerpt 1 of') })
    const result = await processDocument({ id: 'd1', title: 'Notes', text: LONG_DOC }, { router })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.stats.extractionFailed).toBeGreaterThan(0)
      expect(result.value.chunks[0]?.extractionError).toBeTruthy()
      expect(result.value.chunks[0]?.chunk.text).toBeTruthy()
      expect(result.value.chunks.length).toBe(result.value.stats.chunkCount)
    }
  })

  it('embeds chunks on the document side of the asymmetry', async () => {
    const onEmbed = vi.fn()
    const result = await processDocument(
      { id: 'd1', title: 'Notes', text: LONG_DOC },
      { embeddings: fakeEmbeddings(onEmbed) }
    )

    expect(onEmbed).toHaveBeenCalledWith(expect.objectContaining({ taskType: 'document' }))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.stats.embedded).toBe(result.value.stats.chunkCount)
      expect(result.value.embeddingModel).toBe('gemini-embedding-001')
    }
  })

  it('records the embedding space so a later query can be checked against it', async () => {
    const result = await processDocument(
      { id: 'd1', title: 'Notes', text: LONG_DOC },
      { embeddings: fakeEmbeddings() }
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.embeddingProvider).toBe('gemini')
      expect(result.value.chunks[0]?.embedding?.taskType).toBe('document')
    }
  })

  it('fails the document when embedding fails', async () => {
    const broken: AIProvider = {
      name: 'gemini',
      isConfigured: () => true,
      maxEmbeddingBatch: 100,
      complete: async () => {
        throw new Error('x')
      },
      embed: async () => {
        throw new Error('embedding backend down')
      },
    }
    const result = await processDocument(
      { id: 'd1', title: 'Notes', text: LONG_DOC },
      {
        embeddings: createEmbeddingClient([broken], { models: { gemini: 'gemini-embedding-001' } }),
      }
    )
    expect(result.ok).toBe(false)
  })
})

describe('extractSymbols — the parser, not the model', () => {
  it('finds exported and unexported declarations with line numbers', () => {
    const { symbols } = extractSymbols({
      path: 'src/a.ts',
      content: [
        'import { z } from "zod"',
        'export function createPlan() {}',
        'function helper() {}',
        'export interface Plan {}',
        'export type Status = "active"',
        'export const RATE = 1',
        'export class Engine {}',
        'export enum Kind { A }',
      ].join('\n'),
    })

    expect(symbols.map((s) => [s.name, s.kind, s.exported])).toEqual([
      ['createPlan', 'function', true],
      ['helper', 'function', false],
      ['Plan', 'interface', true],
      ['Status', 'type', true],
      ['RATE', 'const', true],
      ['Engine', 'class', true],
      ['Kind', 'enum', true],
    ])
    // 1-indexed, to match every editor and stack trace.
    expect(symbols[0]?.line).toBe(2)
  })

  it('ignores declarations inside comments', () => {
    // A commented-out export must not enter the index as a real one.
    const { symbols } = extractSymbols({
      path: 'src/a.ts',
      content: [
        '// export function ghost() {}',
        '/*',
        'export function alsoGhost() {}',
        '*/',
        'export function real() {}',
      ].join('\n'),
    })

    expect(symbols.map((s) => s.name)).toEqual(['real'])
  })

  it('records imports and marks the ones that stay inside the repo', () => {
    const { imports } = extractSymbols({
      path: 'src/a.ts',
      content: [
        'import { z } from "zod"',
        'import type { X } from "./local"',
        'import "../side-effect"',
        'export * from "./re-export"',
        'const fs = require("node:fs")',
      ].join('\n'),
    })

    expect(imports.map((i) => [i.specifier, i.relative])).toEqual([
      ['zod', false],
      ['./local', true],
      ['../side-effect', true],
      ['./re-export', true],
      ['node:fs', false],
    ])
  })

  it('returns nothing for a language it does not parse', () => {
    const { symbols } = extractSymbols({ path: 'schema.sql', content: 'create table x ();' })
    expect(symbols).toEqual([])
  })

  it('infers language from the extension', () => {
    expect(inferLanguage('a/b.tsx')).toBe('typescript')
    expect(inferLanguage('a/b.mjs')).toBe('javascript')
    expect(inferLanguage('a/b.sql')).toBe('sql')
    expect(inferLanguage('LICENSE')).toBe('unknown')
  })
})

describe('contentHash', () => {
  it('is stable across calls for identical content', () => {
    // Change detection compares these. Instability would make every run
    // look like a full-repository change.
    expect(contentHash('abc')).toBe(contentHash('abc'))
  })

  it('differs for different content', () => {
    expect(contentHash('abc')).not.toBe(contentHash('abd'))
  })

  it('is a fixed-width hex string', () => {
    expect(contentHash('')).toMatch(/^[0-9a-f]{8}$/)
    expect(contentHash('x'.repeat(10_000))).toMatch(/^[0-9a-f]{8}$/)
  })
})

describe('extractRepository', () => {
  const files = [
    { path: 'src/a.ts', content: 'export function alpha() {}\nimport "./b"' },
    { path: 'src/b.ts', content: 'export const beta = 1' },
  ]

  it('refuses an empty file list', async () => {
    const result = await extractRepository([])
    expect(result.ok).toBe(false)
  })

  it('indexes structurally with no model at all', async () => {
    // The structural pass is the actual index and must never require a
    // model — it is free, instant and deterministic.
    const result = await extractRepository(files)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.stats.fileCount).toBe(2)
      expect(result.value.stats.symbolCount).toBe(2)
      expect(result.value.stats.importCount).toBe(1)
      expect(result.value.stats.summarised).toBe(0)
      expect(result.value.files[0]?.hash).toMatch(/^[0-9a-f]{8}$/)
    }
  })

  it('summarises only when a router is supplied', async () => {
    const router = fakeRouter({
      reply: () => ({ purpose: 'Does a thing.', concepts: ['plans'], layer: 'domain' }),
    })
    const result = await extractRepository(files, { router })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.stats.summarised).toBe(2)
      expect(result.value.files[0]?.summary?.purpose).toBe('Does a thing.')
    }
  })

  it('keeps the structural index when summarisation fails', async () => {
    const router = fakeRouter({ fail: 'model unavailable' })
    const result = await extractRepository(files, { router })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.stats.summaryFailed).toBe(2)
      // The part that cost nothing survives the part that cost money.
      expect(result.value.stats.symbolCount).toBe(2)
      expect(result.value.files[0]?.summaryError).toBeTruthy()
    }
  })

  it('skips summarising an oversize file but still indexes it', async () => {
    const router = fakeRouter()
    const big = [{ path: 'src/big.ts', content: `export const x = 1\n${'// pad\n'.repeat(5_000)}` }]
    const result = await extractRepository(big, { router, maxSummaryChars: 100 })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.stats.summarised).toBe(0)
      expect(result.value.stats.symbolCount).toBe(1)
    }
  })

  it('skips files with no symbols rather than paying to summarise them', async () => {
    const router = fakeRouter()
    const spy = vi.spyOn(router, 'complete')
    await extractRepository([{ path: 'notes.md', content: '# just prose' }], { router })
    expect(spy).not.toHaveBeenCalled()
  })

  it('embeds a synthesised descriptor rather than raw source', async () => {
    // A reader searching "where do we enforce budgets" is matching
    // intent; raw syntax embeds mostly to its own boilerplate.
    const captured: string[] = []
    const result = await extractRepository(files, {
      embeddings: fakeEmbeddings((r) => captured.push(...r.inputs)),
    })

    expect(result.ok).toBe(true)
    expect(captured[0]).toContain('src/a.ts')
    expect(captured[0]).toContain('alpha')
    expect(captured[0]).not.toContain('export function alpha() {}')
    if (result.ok) expect(result.value.stats.embedded).toBe(2)
  })
})
