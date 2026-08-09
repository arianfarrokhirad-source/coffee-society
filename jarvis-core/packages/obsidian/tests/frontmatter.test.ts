import { describe, expect, it } from 'vitest'
import {
  composeNote,
  extractLinks,
  parseFrontmatter,
  serialiseFrontmatter,
} from '../src/frontmatter'

// Frontmatter is the machine-readable surface of human prose. The
// properties that matter are round-tripping (a human's note must come
// back unchanged) and refusing to half-parse.

describe('parseFrontmatter', () => {
  it('parses scalars, inline lists and block lists', () => {
    const { frontmatter, body } = parseFrontmatter(
      [
        '---',
        'type: adr',
        'id: ADR-0001',
        'status: accepted',
        'tags: [security, database]',
        'reviewers:',
        '  - alice-role',
        '  - bob-role',
        '---',
        '',
        '# Body here',
      ].join('\n')
    )

    expect(frontmatter?.type).toBe('adr')
    expect(frontmatter?.id).toBe('ADR-0001')
    expect(frontmatter?.tags).toEqual(['security', 'database'])
    expect(frontmatter?.reviewers).toEqual(['alice-role', 'bob-role'])
    expect(body.trim()).toBe('# Body here')
  })

  it('keeps an ISO date a string rather than mangling it into a number', () => {
    // '2026-08-08' starts with digits; a looser numeric check turns it
    // into 2026 or NaN, and the note's date silently becomes wrong.
    const { frontmatter } = parseFrontmatter('---\ntype: ceo\ndate: 2026-08-08\n---\nbody')
    expect(frontmatter?.date).toBe('2026-08-08')
  })

  it('respects quoting as an expression of intent', () => {
    const { frontmatter } = parseFrontmatter('---\ntype: ceo\nid: "42"\nn: 42\n---\nx')
    expect(frontmatter?.id).toBe('42')
    expect(frontmatter?.n).toBe(42)
  })

  it('parses booleans and null', () => {
    const { frontmatter } = parseFrontmatter('---\ntype: ceo\na: true\nb: false\nc: null\n---\nx')
    expect(frontmatter?.a).toBe(true)
    expect(frontmatter?.b).toBe(false)
    expect(frontmatter?.c).toBeNull()
  })

  it('preserves keys it does not model', () => {
    // Discarding a field someone deliberately added is a quiet way to
    // lose their work.
    const { frontmatter } = parseFrontmatter('---\ntype: ceo\ncustom_field: kept\n---\nx')
    expect(frontmatter?.custom_field).toBe('kept')
  })

  it('rejects a note with no type', () => {
    // `type` is the one mandatory field; without it nothing can query
    // the note, so it is not a valid vault note.
    expect(parseFrontmatter('---\nid: X\n---\nbody').frontmatter).toBeNull()
  })

  it('rejects an unknown type rather than accepting it', () => {
    expect(parseFrontmatter('---\ntype: nonsense\n---\nbody').frontmatter).toBeNull()
  })

  it('returns the whole source as body when there is no frontmatter', () => {
    const { frontmatter, body } = parseFrontmatter('# Just markdown')
    expect(frontmatter).toBeNull()
    expect(body).toBe('# Just markdown')
  })

  it('handles CRLF line endings', () => {
    const { frontmatter } = parseFrontmatter('---\r\ntype: sop\r\nowner: ops\r\n---\r\nbody')
    expect(frontmatter?.type).toBe('sop')
    expect(frontmatter?.owner).toBe('ops')
  })
})

describe('round-tripping', () => {
  it('survives parse → serialise → parse unchanged', () => {
    const original = composeNote(
      {
        type: 'adr',
        id: 'ADR-0007',
        title: 'Use content hashes, not mtime',
        status: 'accepted',
        date: '2026-08-08',
        tags: ['indexing', 'graphify'],
      },
      '# Body\n\nSome prose.'
    )

    const first = parseFrontmatter(original)
    const second = parseFrontmatter(composeNote(first.frontmatter!, first.body))

    expect(second.frontmatter).toEqual(first.frontmatter)
    expect(second.body.trim()).toBe(first.body.trim())
  })

  it('quotes a value that would otherwise re-parse as another type', () => {
    const written = serialiseFrontmatter({ type: 'ceo', id: '42', flag: 'true' })
    expect(written).toContain('id: "42"')
    expect(written).toContain('flag: "true"')

    const reparsed = parseFrontmatter(`${written}\nbody`)
    expect(reparsed.frontmatter?.id).toBe('42')
    expect(reparsed.frontmatter?.flag).toBe('true')
  })

  it('always writes type first', () => {
    const written = serialiseFrontmatter({ type: 'sop', owner: 'ops', title: 'x' })
    expect(written.split('\n')[1]).toBe('type: sop')
  })
})

describe('extractLinks', () => {
  it('finds wikilinks and deduplicates them', () => {
    expect(extractLinks('See [[ADR-0001]] and [[ADR-0002]], plus [[ADR-0001]] again.')).toEqual([
      'ADR-0001',
      'ADR-0002',
    ])
  })

  it('strips aliases and headings, because the edge is to the note', () => {
    expect(extractLinks('[[ADR-0001|the hashing decision]]')).toEqual(['ADR-0001'])
    expect(extractLinks('[[SOP-deploy#Rollback]]')).toEqual(['SOP-deploy'])
  })

  it('returns nothing when there are no links', () => {
    expect(extractLinks('Plain prose with [a link](https://example.test).')).toEqual([])
  })
})
