// ---------------------------------------------------------------------
// Chunking.
//
// Retrieval quality is decided here, before any model is involved. A
// chunk is the unit that gets embedded and later returned to a reader,
// so it has to satisfy two opposing pressures:
//
//   Large enough to be self-contained. A chunk that ends mid-argument
//     retrieves as a fragment nobody can act on.
//   Small enough to be specific. A whole document embedded as one vector
//     averages every topic in it into a point that is near nothing.
//
// The resolution used here is: split on the strongest structural
// boundary available (blank lines, then single lines, then hard
// character cuts), pack adjacent pieces up to a target size, and overlap
// consecutive chunks.
//
// Overlap exists for one specific failure: a fact whose subject is in
// one sentence and whose detail is in the next. Split between them and
// NEITHER chunk can answer a question about it — the first lacks the
// detail, the second lacks the subject. Overlap costs storage and buys
// back the boundary cases.
//
// Everything here is deterministic and offline. Re-chunking the same
// input always produces identical chunks, which is what makes change
// detection (Sprint 2) able to compare hashes instead of re-embedding a
// corpus that did not change.
// ---------------------------------------------------------------------

export interface Chunk {
  /** Position in the sequence, from 0. */
  index: number
  text: string
  /** Character offset into the original source, for citation. */
  startOffset: number
  endOffset: number
  /** Approximate token count — see estimateTokens(). */
  estimatedTokens: number
}

export interface ChunkOptions {
  /** Target chunk size in characters. */
  maxChars?: number
  /** Characters of the previous chunk repeated at the start of the next. */
  overlapChars?: number
  /**
   * Chunks shorter than this are merged into the previous chunk rather
   * than stored alone. A 12-character trailing chunk is noise in an
   * index — it matches weakly against everything.
   */
  minChars?: number
}

export const DEFAULT_CHUNK_OPTIONS = {
  maxChars: 2_000,
  overlapChars: 200,
  minChars: 100,
} as const

/**
 * Rough token estimate at ~4 characters per token.
 *
 * Deliberately named an estimate. Real tokenisation is model-specific
 * and would mean shipping a tokeniser per provider; this is used for
 * budget *pre-flight* sizing only. Anything that must be exact reads the
 * provider's reported usage instead, which is why UsageRecord carries
 * real token counts and never these.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/** Splits into paragraphs, keeping their offsets in the original text. */
function splitParagraphs(text: string): { text: string; start: number }[] {
  const pieces: { text: string; start: number }[] = []
  const pattern = /\n\s*\n/g
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    pieces.push({ text: text.slice(cursor, match.index), start: cursor })
    cursor = match.index + match[0].length
  }
  pieces.push({ text: text.slice(cursor), start: cursor })

  return pieces.filter((piece) => piece.text.trim().length > 0)
}

/**
 * Breaks a piece that is already larger than maxChars.
 *
 * Tries line boundaries first so code and lists survive intact, and only
 * cuts mid-line when a single line is itself oversize (a minified file,
 * a base64 blob). Falling straight to character cuts would shred every
 * long source file unnecessarily.
 */
function hardSplit(
  text: string,
  start: number,
  maxChars: number
): { text: string; start: number }[] {
  if (text.length <= maxChars) return [{ text, start }]

  const out: { text: string; start: number }[] = []
  let buffer = ''
  let bufferStart = start
  let offset = start

  for (const line of text.split('\n')) {
    const candidate = buffer === '' ? line : `${buffer}\n${line}`

    if (candidate.length <= maxChars) {
      if (buffer === '') bufferStart = offset
      buffer = candidate
      offset += line.length + 1
      continue
    }

    if (buffer !== '') {
      out.push({ text: buffer, start: bufferStart })
      buffer = ''
    }

    if (line.length <= maxChars) {
      buffer = line
      bufferStart = offset
      offset += line.length + 1
      continue
    }

    // A single line longer than the budget. Nothing structural is left
    // to respect, so cut by characters.
    for (let cut = 0; cut < line.length; cut += maxChars) {
      out.push({ text: line.slice(cut, cut + maxChars), start: offset + cut })
    }
    offset += line.length + 1
  }

  if (buffer !== '') out.push({ text: buffer, start: bufferStart })
  return out
}

/**
 * Splits text into overlapping chunks on structural boundaries.
 *
 * Returns [] for blank input rather than one empty chunk — an empty
 * chunk embeds to a meaningless vector that matches queries at random.
 */
export function chunkText(text: string, options: ChunkOptions = {}): Chunk[] {
  const maxChars = Math.max(1, options.maxChars ?? DEFAULT_CHUNK_OPTIONS.maxChars)
  const minChars = options.minChars ?? DEFAULT_CHUNK_OPTIONS.minChars
  // Overlap must stay strictly under the chunk size, or each chunk
  // begins with a copy of the whole previous one and the splitter never
  // advances — an infinite loop in the naive formulation.
  const overlapChars = Math.min(
    options.overlapChars ?? DEFAULT_CHUNK_OPTIONS.overlapChars,
    Math.floor(maxChars / 2)
  )

  if (text.trim().length === 0) return []

  const pieces = splitParagraphs(text).flatMap((piece) =>
    hardSplit(piece.text, piece.start, maxChars)
  )

  // Pack adjacent pieces up to the target size.
  const packed: { text: string; start: number; end: number }[] = []
  let current: { text: string; start: number; end: number } | null = null

  for (const piece of pieces) {
    const end = piece.start + piece.text.length
    if (current === null) {
      current = { text: piece.text, start: piece.start, end }
      continue
    }
    // Annotated because `current` is reassigned from an expression that
    // reads it, and inference otherwise walks in a circle (TS7022).
    const joined: string = `${current.text}\n\n${piece.text}`
    if (joined.length <= maxChars) {
      current = { text: joined, start: current.start, end }
    } else {
      packed.push(current)
      current = { text: piece.text, start: piece.start, end }
    }
  }
  if (current !== null) packed.push(current)

  // Merge a runt tail backwards. Done after packing so it only ever
  // affects the final chunk, where it actually occurs.
  if (packed.length > 1) {
    const last = packed[packed.length - 1]
    const previous = packed[packed.length - 2]
    if (
      last &&
      previous &&
      last.text.length < minChars &&
      previous.text.length + last.text.length <= maxChars
    ) {
      packed.splice(packed.length - 2, 2, {
        text: `${previous.text}\n\n${last.text}`,
        start: previous.start,
        end: last.end,
      })
    }
  }

  return packed.map((entry, index) => {
    const previous = index > 0 ? packed[index - 1] : undefined
    // Overlap is prepended from the previous chunk's tail. startOffset
    // still points at this chunk's own beginning, so citations resolve
    // to the right place rather than into the borrowed prefix.
    const prefix = previous && overlapChars > 0 ? previous.text.slice(-overlapChars) : ''
    const body = prefix ? `${prefix}\n${entry.text}` : entry.text

    return {
      index,
      text: body,
      startOffset: entry.start,
      endOffset: entry.end,
      estimatedTokens: estimateTokens(body),
    }
  })
}
