import { describe, expect, it } from 'vitest'
import { chunkText, estimateTokens } from '../src/chunking'

// Chunking is where retrieval quality is decided, and it is entirely
// deterministic — which means every property worth having can be pinned
// here, offline, with no model involved.

describe('chunkText', () => {
  it('returns nothing for blank input', () => {
    // An empty chunk embeds to a vector that matches queries at random.
    expect(chunkText('')).toEqual([])
    expect(chunkText('   \n\n  \t ')).toEqual([])
  })

  it('keeps a short document as a single chunk', () => {
    const chunks = chunkText('One short paragraph about coffee.')
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.text).toContain('coffee')
    expect(chunks[0]?.index).toBe(0)
  })

  it('splits on paragraph boundaries before character boundaries', () => {
    const paragraph = 'a'.repeat(600)
    const text = [paragraph, paragraph, paragraph, paragraph].join('\n\n')
    const chunks = chunkText(text, { maxChars: 1_000, overlapChars: 0 })

    expect(chunks.length).toBeGreaterThan(1)
    // Packing two 600-char paragraphs would exceed 1,000, so each chunk
    // carries exactly one — the boundary was respected, not cut through.
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(1_000)
  })

  it('overlaps consecutive chunks so a fact spanning a boundary survives', () => {
    const first = 'The maintenance plan renews monthly. '.repeat(30)
    const second = 'It is billed in EUR and may be paused. '.repeat(30)
    const chunks = chunkText(`${first}\n\n${second}`, { maxChars: 1_200, overlapChars: 150 })

    expect(chunks.length).toBeGreaterThan(1)
    const tail = chunks[0]?.text.slice(-150) ?? ''
    expect(chunks[1]?.text.startsWith(tail)).toBe(true)
  })

  it('never lets overlap reach the chunk size', () => {
    // Overlap >= maxChars means each chunk restates the previous one and
    // the splitter stops advancing. The clamp is what prevents a hang.
    const chunks = chunkText('word '.repeat(2_000), { maxChars: 500, overlapChars: 5_000 })
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.length).toBeLessThan(500)
  })

  it('splits an oversize paragraph on line boundaries', () => {
    const lines = Array.from({ length: 60 }, (_, i) => `const value${i} = ${i}`).join('\n')
    const chunks = chunkText(lines, { maxChars: 200, overlapChars: 0 })

    expect(chunks.length).toBeGreaterThan(1)
    // Code survives intact: no chunk ends mid-identifier.
    for (const chunk of chunks) expect(chunk.text).not.toMatch(/const value\d*$/)
  })

  it('cuts mid-line only when one line exceeds the budget', () => {
    const chunks = chunkText('x'.repeat(1_000), { maxChars: 100, overlapChars: 0 })
    expect(chunks).toHaveLength(10)
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(100)
  })

  it('merges a runt tail into the previous chunk', () => {
    const body = 'a'.repeat(900)
    const chunks = chunkText(`${body}\n\ntiny`, { maxChars: 1_000, overlapChars: 0, minChars: 100 })
    // 'tiny' alone would match weakly against everything in the index.
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.text).toContain('tiny')
  })

  it('reports offsets that point into the original text', () => {
    const text = ['first paragraph here', 'second paragraph here'].join('\n\n')
    const chunks = chunkText(text, { maxChars: 25, overlapChars: 0 })

    for (const chunk of chunks) {
      expect(chunk.startOffset).toBeGreaterThanOrEqual(0)
      expect(chunk.endOffset).toBeLessThanOrEqual(text.length)
      expect(chunk.endOffset).toBeGreaterThan(chunk.startOffset)
    }
    expect(chunks[0]?.startOffset).toBe(0)
  })

  it('is deterministic — the same input always chunks identically', () => {
    // Sprint 2's change detection compares hashes of chunk output. Any
    // nondeterminism here would make every run look like a change.
    const text = 'Paragraph one.\n\nParagraph two.\n\nParagraph three.'.repeat(20)
    expect(chunkText(text)).toEqual(chunkText(text))
  })

  it('numbers chunks contiguously from zero', () => {
    const chunks = chunkText('para\n\n'.repeat(50), { maxChars: 50, overlapChars: 0 })
    chunks.forEach((chunk, index) => expect(chunk.index).toBe(index))
  })
})

describe('estimateTokens', () => {
  it('approximates at four characters per token', () => {
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('a'.repeat(400))).toBe(100)
  })

  it('never reports zero for non-empty text', () => {
    // A chunk that estimates 0 tokens would slip past pre-flight sizing.
    expect(estimateTokens('a')).toBe(1)
  })
})
