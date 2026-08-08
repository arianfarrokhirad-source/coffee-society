import { z } from 'zod'
import { err, ok, type Result } from '@jarvis/shared'
import { runBatch, type BatchStopReason } from '../batch'
import { chunkText, type Chunk, type ChunkOptions } from '../chunking'
import type { EmbeddedVector, EmbeddingClient } from '../embeddings'
import type { AIRouter } from '../router'
import { completeStructured } from '../structured'

// ---------------------------------------------------------------------
// Document processing.
//
// One document in, an indexed and summarised document out. The stages
// are deliberately separable, because they fail differently and cost
// differently:
//
//   chunk    — free, deterministic, offline
//   extract  — expensive, non-deterministic, needs a model
//   embed    — cheap per item but high volume
//
// Extraction and embedding are both optional. A caller that only wants
// search does not pay for summaries; a caller that only wants a summary
// does not pay to embed. Making them mandatory is how a "process this
// document" call quietly becomes the largest line on the bill.
//
// The route used for extraction is `extraction`, which ROUTE_PREFERENCE
// leads with Gemini — this is the concrete point at which Gemini takes
// over work that previously had to go to Claude.
// ---------------------------------------------------------------------

export interface SourceDocument {
  id: string
  title: string
  text: string
  /** Free-form provenance, e.g. 'proposal', 'meeting-note', 'sop'. */
  kind?: string
}

const factsSchema = z.object({
  summary: z.string(),
  topics: z.array(z.string()).max(12),
  entities: z.array(z.string()).max(24),
  /** Commitments and next steps. Empty is a legitimate answer. */
  actions: z.array(z.string()).max(12),
})

export type ChunkFacts = z.infer<typeof factsSchema>

export interface ProcessedChunk {
  chunk: Chunk
  /** Absent when extraction was disabled or failed for this chunk. */
  facts?: ChunkFacts
  /** Absent when embedding was disabled or the chunk was unembeddable. */
  embedding?: EmbeddedVector
  /** Set when this chunk's extraction failed while others succeeded. */
  extractionError?: string
}

export interface ProcessedDocument {
  documentId: string
  title: string
  chunks: ProcessedChunk[]
  /** Union of chunk topics, deduplicated, order-stable. */
  topics: string[]
  entities: string[]
  actions: string[]
  /** Embedding space, so a later search can refuse a mismatched query. */
  embeddingProvider: string | null
  embeddingModel: string | null
  stats: {
    chunkCount: number
    extracted: number
    extractionFailed: number
    embedded: number
    stopReason: BatchStopReason
  }
}

export interface ProcessDocumentOptions {
  router?: AIRouter
  embeddings?: EmbeddingClient
  chunking?: ChunkOptions
  concurrency?: number
  /** Extraction is skipped when no router is supplied. */
  extract?: boolean
  /** Embedding is skipped when no embedding client is supplied. */
  embed?: boolean
}

/** Deduplicates while preserving first-seen order and trimming blanks. */
function mergeUnique(lists: readonly (readonly string[])[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const list of lists) {
    for (const raw of list) {
      const value = raw.trim()
      if (value === '') continue
      const key = value.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(value)
    }
  }
  return out
}

export async function processDocument(
  document: SourceDocument,
  options: ProcessDocumentOptions = {}
): Promise<Result<ProcessedDocument>> {
  const chunks = chunkText(document.text, options.chunking)
  if (chunks.length === 0) return err(`Document '${document.id}' has no extractable text.`)

  const processed: ProcessedChunk[] = chunks.map((chunk) => ({ chunk }))
  let stopReason: BatchStopReason = 'completed'

  // --- Extraction -----------------------------------------------------
  const shouldExtract = options.extract !== false && !!options.router
  if (shouldExtract && options.router) {
    const router = options.router
    const report = await runBatch(
      chunks.map((chunk) => ({ id: String(chunk.index), input: chunk })),
      async (chunk) => {
        const outcome = await completeStructured(router, 'extraction', factsSchema, [
          {
            role: 'system',
            content:
              'You extract facts from an excerpt of a business document. ' +
              'Only report what the excerpt states. Do not infer, do not ' +
              'generalise, and return empty arrays rather than guesses.',
          },
          {
            role: 'user',
            content: `Document: ${document.title}\nExcerpt ${chunk.index + 1} of ${chunks.length}:\n\n${chunk.text}`,
          },
        ])
        return outcome.ok ? ok(outcome.value.data) : err(outcome.error)
      },
      { concurrency: options.concurrency ?? 4 }
    )

    stopReason = report.stopReason
    for (const result of report.results) {
      const target = processed[result.index]
      if (!target) continue
      // A chunk that failed extraction keeps its text and its embedding.
      // Dropping it would make the document silently incomplete in
      // search while looking successful.
      if (result.ok && result.value) target.facts = result.value
      else if (result.error) target.extractionError = result.error
    }
  }

  // --- Embedding ------------------------------------------------------
  const shouldEmbed = options.embed !== false && !!options.embeddings
  let embeddingProvider: string | null = null
  let embeddingModel: string | null = null

  if (shouldEmbed && options.embeddings) {
    // 'document' — the stored side of the asymmetry. A search must embed
    // its query with 'query' against the same model, never with this.
    const embedded = await options.embeddings.embed(
      chunks.map((chunk) => chunk.text),
      'document'
    )
    if (!embedded.ok) return err(`Embedding failed for '${document.id}': ${embedded.error}`)

    embeddingProvider = embedded.value.provider
    embeddingModel = embedded.value.model
    for (const vector of embedded.value.vectors) {
      const target = processed[vector.index]
      if (target) target.embedding = vector
    }
  }

  const facts = processed
    .map((entry) => entry.facts)
    .filter((entry): entry is ChunkFacts => entry !== undefined)

  return ok({
    documentId: document.id,
    title: document.title,
    chunks: processed,
    topics: mergeUnique(facts.map((entry) => entry.topics)),
    entities: mergeUnique(facts.map((entry) => entry.entities)),
    actions: mergeUnique(facts.map((entry) => entry.actions)),
    embeddingProvider,
    embeddingModel,
    stats: {
      chunkCount: chunks.length,
      extracted: facts.length,
      extractionFailed: processed.filter((entry) => entry.extractionError).length,
      embedded: processed.filter((entry) => entry.embedding).length,
      stopReason,
    },
  })
}
