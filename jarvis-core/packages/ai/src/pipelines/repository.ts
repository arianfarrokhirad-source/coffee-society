import { z } from 'zod'
import { err, ok, type Result } from '@jarvis/shared'
import { runBatch, type BatchStopReason } from '../batch'
import { chunkText } from '../chunking'
import type { EmbeddedVector, EmbeddingClient } from '../embeddings'
import type { AIRouter } from '../router'
import { completeStructured } from '../structured'

// ---------------------------------------------------------------------
// Repository extraction.
//
// Two decisions shape this file, and both are about NOT using a model.
//
// 1. Symbols and imports are extracted with a parser, not an LLM.
//    Asking a model to "list the exported functions" costs tokens, takes
//    seconds, varies between runs, and is occasionally wrong — while the
//    same answer is available deterministically, instantly, for free.
//    The rule: never spend a model on a question a parser can answer.
//    Models are for judgement (what is this module FOR?), not for
//    facts already present in the syntax.
//
// 2. No filesystem access. This module takes file contents that someone
//    else read. That keeps it pure and unit-testable, and it is what
//    stops Sprint 2's Graphify walker and this pipeline from becoming
//    two half-implementations of the same traversal.
//
// The regex extraction is intentionally shallow — declarations, not a
// type system. It is an index, and an index that is 95% right and
// instant beats one that is 99% right and needs a compiler pass on
// every keystroke. Where it is wrong it under-reports; it does not
// invent symbols that are not there.
// ---------------------------------------------------------------------

export interface SourceFile {
  /** Repository-relative path. Used as the symbol's address. */
  path: string
  content: string
  /** Inferred from the extension when omitted. */
  language?: string
}

export type SymbolKind = 'function' | 'class' | 'interface' | 'type' | 'const' | 'enum' | 'unknown'

export interface ExtractedSymbol {
  name: string
  kind: SymbolKind
  exported: boolean
  /** 1-indexed, to match every editor and stack trace. */
  line: number
}

export interface ExtractedImport {
  /** Module specifier exactly as written. */
  specifier: string
  /** True for './x' and '../x' — the edges that stay inside the repo. */
  relative: boolean
  line: number
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  sql: 'sql',
  md: 'markdown',
  json: 'json',
  css: 'css',
  yml: 'yaml',
  yaml: 'yaml',
}

export function inferLanguage(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  return LANGUAGE_BY_EXTENSION[extension] ?? 'unknown'
}

/**
 * Declaration patterns for the TypeScript/JavaScript family.
 *
 * Anchored to the start of a line, so a declaration keyword inside a
 * string or a comment body does not register as a symbol. This is the
 * cheap approximation of "top-level" and it holds for normally
 * formatted code.
 */
const DECLARATION_PATTERNS: { pattern: RegExp; kind: SymbolKind }[] = [
  { pattern: /^\s*(export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)/, kind: 'function' },
  { pattern: /^\s*(export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/, kind: 'class' },
  { pattern: /^\s*(export\s+)?interface\s+(\w+)/, kind: 'interface' },
  { pattern: /^\s*(export\s+)?type\s+(\w+)/, kind: 'type' },
  { pattern: /^\s*(export\s+)?enum\s+(\w+)/, kind: 'enum' },
  { pattern: /^\s*(export\s+)?(?:const|let|var)\s+(\w+)/, kind: 'const' },
]

const IMPORT_PATTERNS: RegExp[] = [
  /^\s*import\s+(?:type\s+)?[^'"]*from\s+['"]([^'"]+)['"]/,
  /^\s*import\s+['"]([^'"]+)['"]/,
  /^\s*export\s+(?:type\s+)?\*?[^'"]*from\s+['"]([^'"]+)['"]/,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/,
]

/** Symbols and imports, by parsing. Never calls a model. */
export function extractSymbols(file: SourceFile): {
  symbols: ExtractedSymbol[]
  imports: ExtractedImport[]
} {
  const language = file.language ?? inferLanguage(file.path)
  const symbols: ExtractedSymbol[] = []
  const imports: ExtractedImport[] = []

  if (language !== 'typescript' && language !== 'javascript') {
    return { symbols, imports }
  }

  const lines = file.content.split('\n')
  let inBlockComment = false

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? ''
    const line = raw.trim()

    // Block comments are tracked rather than stripped, so a commented-out
    // export does not enter the index as a real one.
    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false
      continue
    }
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) inBlockComment = true
      continue
    }
    if (line === '' || line.startsWith('//') || line.startsWith('*')) continue

    for (const pattern of IMPORT_PATTERNS) {
      const match = pattern.exec(raw)
      const specifier = match?.[1]
      if (!specifier) continue
      imports.push({
        specifier,
        relative: specifier.startsWith('.'),
        line: i + 1,
      })
      break
    }

    for (const { pattern, kind } of DECLARATION_PATTERNS) {
      const match = pattern.exec(raw)
      const name = match?.[2]
      if (!name) continue
      symbols.push({ name, kind, exported: match[1] !== undefined, line: i + 1 })
      break
    }
  }

  return { symbols, imports }
}

const moduleSummarySchema = z.object({
  /** One sentence on what the module is for. */
  purpose: z.string(),
  /** Domain concepts the module deals in. */
  concepts: z.array(z.string()).max(10),
  /** Where it sits: 'api', 'ui', 'domain', 'infrastructure', 'test'. */
  layer: z.string(),
})

export type ModuleSummary = z.infer<typeof moduleSummarySchema>

export interface ExtractedFile {
  path: string
  language: string
  /** Content hash, for Sprint 2 change detection. */
  hash: string
  lineCount: number
  symbols: ExtractedSymbol[]
  imports: ExtractedImport[]
  /** Present only when AI summarisation ran and succeeded. */
  summary?: ModuleSummary
  summaryError?: string
  embedding?: EmbeddedVector
}

export interface RepositoryExtraction {
  files: ExtractedFile[]
  stats: {
    fileCount: number
    symbolCount: number
    importCount: number
    summarised: number
    summaryFailed: number
    embedded: number
    stopReason: BatchStopReason
  }
}

/**
 * FNV-1a, 32-bit. Not cryptographic and not meant to be — this answers
 * "did this file change since the last index?", where collisions cost a
 * redundant re-index rather than a security failure. It is chosen for
 * being dependency-free and stable across runs and platforms, which
 * JSON.stringify ordering and Date-based mtimes are not.
 */
export function contentHash(content: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < content.length; i += 1) {
    hash ^= content.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export interface ExtractRepositoryOptions {
  /** Omit to index symbols only — free, offline, and often enough. */
  router?: AIRouter
  embeddings?: EmbeddingClient
  concurrency?: number
  /** Files above this are indexed structurally but never summarised. */
  maxSummaryChars?: number
}

export async function extractRepository(
  files: readonly SourceFile[],
  options: ExtractRepositoryOptions = {}
): Promise<Result<RepositoryExtraction>> {
  if (files.length === 0) return err('No source files supplied.')

  const maxSummaryChars = options.maxSummaryChars ?? 20_000

  // Structural pass. Always runs, costs nothing, and is the part that
  // must never be skipped — it is the actual index.
  const extracted: ExtractedFile[] = files.map((file) => {
    const { symbols, imports } = extractSymbols(file)
    return {
      path: file.path,
      language: file.language ?? inferLanguage(file.path),
      hash: contentHash(file.content),
      lineCount: file.content.split('\n').length,
      symbols,
      imports,
    }
  })

  let stopReason: BatchStopReason = 'completed'

  // Semantic pass. Optional, and only for files a model can help with.
  if (options.router) {
    const router = options.router
    const candidates = files
      .map((file, index) => ({ file, index }))
      .filter(
        ({ file, index }) =>
          file.content.trim().length > 0 &&
          file.content.length <= maxSummaryChars &&
          (extracted[index]?.symbols.length ?? 0) > 0
      )

    const report = await runBatch(
      candidates.map(({ file, index }) => ({ id: file.path, input: { file, index } })),
      async ({ file, index }) => {
        const symbols = extracted[index]?.symbols ?? []
        // Only the first chunk is sent. A module's purpose is stated at
        // the top — imports, exports and the header comment. Sending the
        // whole file multiplies cost for information that rarely changes
        // the one-sentence answer.
        const head = chunkText(file.content, { maxChars: 4_000, overlapChars: 0 })[0]
        const outcome = await completeStructured(router, 'extraction', moduleSummarySchema, [
          {
            role: 'system',
            content:
              'You summarise a source module for a code index. Describe ' +
              'what it is for, not how it works. Be specific to this ' +
              'module; generic descriptions are useless in an index.',
          },
          {
            role: 'user',
            content:
              `Path: ${file.path}\n` +
              `Exported symbols: ${symbols
                .filter((symbol) => symbol.exported)
                .map((symbol) => `${symbol.kind} ${symbol.name}`)
                .join(', ')}\n\n` +
              `Source:\n${head?.text ?? ''}`,
          },
        ])
        return outcome.ok ? ok(outcome.value.data) : err(outcome.error)
      },
      { concurrency: options.concurrency ?? 4 }
    )

    stopReason = report.stopReason
    for (const result of report.results) {
      const candidate = candidates[result.index]
      if (!candidate) continue
      const target = extracted[candidate.index]
      if (!target) continue
      if (result.ok && result.value) target.summary = result.value
      else if (result.error) target.summaryError = result.error
    }
  }

  // Embedding pass. Embeds a synthesised descriptor rather than raw
  // source: a reader searching for "where do we enforce budgets" is
  // matching intent, and raw syntax embeds mostly to its own boilerplate.
  if (options.embeddings) {
    const descriptors = extracted.map((file) =>
      [
        file.path,
        file.summary?.purpose ?? '',
        file.summary?.concepts.join(', ') ?? '',
        file.symbols
          .filter((symbol) => symbol.exported)
          .map((symbol) => symbol.name)
          .join(' '),
      ]
        .filter((part) => part.trim() !== '')
        .join('\n')
    )

    const embedded = await options.embeddings.embed(descriptors, 'document')
    if (!embedded.ok) return err(`Repository embedding failed: ${embedded.error}`)
    for (const vector of embedded.value.vectors) {
      const target = extracted[vector.index]
      if (target) target.embedding = vector
    }
  }

  return ok({
    files: extracted,
    stats: {
      fileCount: extracted.length,
      symbolCount: extracted.reduce((sum, file) => sum + file.symbols.length, 0),
      importCount: extracted.reduce((sum, file) => sum + file.imports.length, 0),
      summarised: extracted.filter((file) => file.summary).length,
      summaryFailed: extracted.filter((file) => file.summaryError).length,
      embedded: extracted.filter((file) => file.embedding).length,
      stopReason,
    },
  })
}
