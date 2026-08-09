import { describe, expect, it } from 'vitest'
import { createMemoryVaultFs } from '../src/fs'
import { composeNote } from '../src/frontmatter'
import { scanForIdentityData } from '../src/guard'
import { renderAdr, renderSop } from '../src/templates'
import { createVault, slugify } from '../src/vault'

// The vault's job is to make authored knowledge queryable without
// letting it degrade into a cache. The two rules that carry that —
// agent writes land unreviewed, and identity data never lands at all —
// are enforced here rather than left to discipline.

function vaultWith(files: Record<string, string>) {
  const fs = createMemoryVaultFs(files)
  return { fs, vault: createVault(fs) }
}

const ADR = composeNote(
  {
    type: 'adr',
    id: 'ADR-0001',
    title: 'Content hashes over mtime',
    status: 'accepted',
    date: '2026-08-01',
    tags: ['indexing'],
  },
  '# ADR-0001\n\nWe hash content because mtime lies after a checkout.'
)

const SOP = composeNote(
  {
    type: 'sop',
    title: 'Deploy the command centre',
    owner: 'ops',
    lastReviewed: '2026-01-15',
    reviewCycle: 'quarterly',
  },
  '# SOP\n\nSee [[ADR-0001]] before deploying.'
)

const CEO = composeNote(
  { type: 'ceo', title: 'Launch priorities', date: '2026-08-05', tags: ['strategy', 'launch'] },
  '# Priorities\n\nFirst paying customer by 28 August.'
)

const BASE = {
  '10-decisions/ADR-0001-content-hashes.md': ADR,
  '20-sops/SOP-deploy.md': SOP,
  '50-ceo/launch-priorities.md': CEO,
}

describe('reading the vault', () => {
  it('parses every note with valid frontmatter', async () => {
    const { vault } = vaultWith(BASE)
    const notes = await vault.notes()
    expect(notes).toHaveLength(3)
    expect(notes.map((note) => note.frontmatter.type).sort()).toEqual(['adr', 'ceo', 'sop'])
  })

  it('skips a note without frontmatter rather than failing the whole read', async () => {
    // One bad file must not make the vault unqueryable.
    const { vault } = vaultWith({ ...BASE, 'junk.md': '# no frontmatter' })
    expect(await vault.notes()).toHaveLength(3)
  })

  it('resolves a note by slug or by id', async () => {
    const { vault } = vaultWith(BASE)
    expect((await vault.get('ADR-0001-content-hashes'))?.frontmatter.id).toBe('ADR-0001')
    expect((await vault.get('ADR-0001'))?.frontmatter.id).toBe('ADR-0001')
    expect(await vault.get('nope')).toBeNull()
  })

  it('finds backlinks', async () => {
    const { vault } = vaultWith(BASE)
    const linking = await vault.backlinks('ADR-0001')
    expect(linking.map((note) => note.frontmatter.type)).toEqual(['sop'])
  })
})

describe('querying', () => {
  it('filters by type', async () => {
    const { vault } = vaultWith(BASE)
    expect(await vault.query({ type: 'adr' })).toHaveLength(1)
    expect(await vault.query({ type: ['adr', 'sop'] })).toHaveLength(2)
  })

  it('requires every requested tag, not any', async () => {
    // An OR filter widens as the caller narrows — the opposite of what
    // they asked for.
    const { vault } = vaultWith(BASE)
    expect(await vault.query({ tags: ['strategy'] })).toHaveLength(1)
    expect(await vault.query({ tags: ['strategy', 'launch'] })).toHaveLength(1)
    expect(await vault.query({ tags: ['strategy', 'absent'] })).toHaveLength(0)
  })

  it('filters by status and business', async () => {
    const { vault } = vaultWith({
      ...BASE,
      '30-businesses/A01/pricing.md': composeNote(
        { type: 'business', title: 'Pricing', business: 'A01', status: 'reviewed' },
        'Prices are seasonal.'
      ),
    })
    expect(await vault.query({ business: 'A01' })).toHaveLength(1)
    expect(await vault.query({ status: 'accepted' })).toHaveLength(1)
  })

  it('treats a never-reviewed note as overdue', async () => {
    // That is the whole point of asking which notes need review.
    const { vault } = vaultWith({
      '20-sops/SOP-a.md': composeNote({ type: 'sop', title: 'A', owner: 'ops' }, 'x'),
      '20-sops/SOP-b.md': SOP,
    })
    const overdue = await vault.query({ reviewedBefore: '2026-06-01' })
    expect(overdue).toHaveLength(2)

    const recent = await vault.query({ reviewedBefore: '2025-01-01' })
    expect(recent).toHaveLength(1)
  })
})

describe('search', () => {
  it('ranks an exact id match above body text', async () => {
    // "show me ADR-0001" must return that ADR, not whatever mentions it.
    const { vault } = vaultWith(BASE)
    const hits = await vault.search('ADR-0001')
    expect(hits[0]?.note.frontmatter.id).toBe('ADR-0001')
  })

  it('matches body text and returns excerpts for provenance', async () => {
    const { vault } = vaultWith(BASE)
    const hits = await vault.search('mtime')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.excerpts[0]).toContain('mtime')
    expect(hits[0]?.note.path).toBe('10-decisions/ADR-0001-content-hashes.md')
  })

  it('honours a filter alongside the text', async () => {
    const { vault } = vaultWith(BASE)
    expect(await vault.search('deploying', { type: 'adr' })).toHaveLength(0)
    expect(await vault.search('deploying', { type: 'sop' })).toHaveLength(1)
  })

  it('returns nothing for an empty query rather than everything', async () => {
    const { vault } = vaultWith(BASE)
    expect(await vault.search('   ')).toEqual([])
  })
})

describe('agent capture is always unreviewed', () => {
  it('lands in the inbox regardless of type', async () => {
    // If agents wrote reviewed knowledge directly, the vault would be a
    // second derived cache and its only advantage over Graphify — that
    // a human vouched for it — would disappear.
    const { fs, vault } = vaultWith(BASE)
    const result = await vault.capture({
      type: 'adr',
      title: 'Some proposed decision',
      body: 'Reasoning here.',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.path).toBe('00-inbox/some-proposed-decision.md')
      expect(fs.files.get(result.value.path)).toContain('status: unreviewed')
    }
  })

  it('forces unreviewed even when the caller asks for reviewed', async () => {
    const { fs, vault } = vaultWith({})
    const result = await vault.capture({
      type: 'ceo',
      title: 'Sneaky',
      body: 'x',
      frontmatter: { status: 'reviewed' },
    })

    expect(result.ok).toBe(true)
    if (result.ok) expect(fs.files.get(result.value.path)).toContain('status: unreviewed')
  })

  it('does not overwrite an existing capture', async () => {
    const { vault } = vaultWith({})
    const first = await vault.capture({ type: 'ceo', title: 'Same title', body: 'a' })
    const second = await vault.capture({ type: 'ceo', title: 'Same title', body: 'b' })

    expect(first.ok && second.ok).toBe(true)
    if (first.ok && second.ok) expect(second.value.path).not.toBe(first.value.path)
  })

  it('refuses a note with no title', async () => {
    const { vault } = vaultWith({})
    expect((await vault.capture({ type: 'ceo', title: '  ', body: 'x' })).ok).toBe(false)
  })

  it('promotes an inbox note into its type’s folder and marks it reviewed', async () => {
    const { fs, vault } = vaultWith({})
    const captured = await vault.capture({ type: 'sop', title: 'New procedure', body: 'Steps.' })
    expect(captured.ok).toBe(true)
    if (!captured.ok) return

    const promoted = await vault.promote(captured.value.path)
    expect(promoted.ok).toBe(true)
    if (promoted.ok) {
      expect(promoted.value.path).toBe('20-sops/new-procedure.md')
      expect(fs.files.get(promoted.value.path)).toContain('status: reviewed')
    }
  })

  it('refuses to promote over an existing note', async () => {
    const { vault } = vaultWith({ '50-ceo/x.md': CEO, '00-inbox/x.md': CEO })
    expect((await vault.promote('00-inbox/x.md')).ok).toBe(false)
  })
})

describe('identity-data guard', () => {
  it('refuses a capture containing an email address', async () => {
    const { fs, vault } = vaultWith({})
    const result = await vault.capture({
      type: 'meeting',
      title: 'Client call',
      body: 'Spoke to the owner, reachable at sam@acme.test',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/email/i)
    // Nothing reached disk.
    expect(fs.files.size).toBe(0)
  })

  it('refuses a capture containing a phone number', async () => {
    const { vault } = vaultWith({})
    const result = await vault.capture({
      type: 'meeting',
      title: 'Call',
      body: 'Ring them on +44 7700 900123 tomorrow.',
    })
    expect(result.ok).toBe(false)
  })

  it('never echoes the matched value, only its category', async () => {
    // A guard that logs what it caught has moved the leak, not stopped it.
    const { vault } = vaultWith({})
    const result = await vault.capture({
      type: 'meeting',
      title: 'Call',
      body: 'sam@acme.test',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).not.toContain('sam@acme.test')
  })

  it('allows ordinary business facts through', async () => {
    const { vault } = vaultWith({})
    const result = await vault.capture({
      type: 'business',
      title: 'Pricing',
      body: 'Maintenance is 400 EUR per month. Renewal is annual. Margin is 62%.',
    })
    expect(result.ok).toBe(true)
  })

  it('does not flag wikilinks or URLs', async () => {
    expect(scanForIdentityData('See [[ADR-0001]] and https://example.test/1234567890123')).toEqual(
      []
    )
  })

  it('flags a credential', async () => {
    expect(scanForIdentityData('key: sk-abcdefghijklmnop')[0]?.kind).toBe('secret')
  })

  it('flags an identity field header', async () => {
    expect(scanForIdentityData('full_name: someone')[0]?.kind).toBe('identity_field')
  })
})

describe('validation', () => {
  it('reports a note with no frontmatter', async () => {
    const { vault } = vaultWith({ ...BASE, 'broken.md': '# nothing' })
    const issues = await vault.validate()
    expect(issues).toContainEqual({
      path: 'broken.md',
      severity: 'error',
      message: 'Missing or invalid frontmatter (`type` is mandatory).',
    })
  })

  it('reports a link that resolves to nothing', async () => {
    const { vault } = vaultWith({
      '50-ceo/a.md': composeNote({ type: 'ceo', title: 'A' }, 'See [[does-not-exist]].'),
    })
    const issues = await vault.validate()
    expect(issues.some((issue) => issue.message.includes('does-not-exist'))).toBe(true)
  })

  it('reports an SOP with no review date', async () => {
    // An unreviewed SOP is a liability precisely because it looks
    // authoritative — people follow it.
    const { vault } = vaultWith({
      '20-sops/x.md': composeNote({ type: 'sop', title: 'X', owner: 'ops' }, 'Steps.'),
    })
    const issues = await vault.validate()
    expect(issues.some((issue) => issue.message === 'SOP has no lastReviewed.')).toBe(true)
  })

  it('reports a malformed ADR id', async () => {
    const { vault } = vaultWith({
      '10-decisions/x.md': composeNote({ type: 'adr', id: 'ADR-1', title: 'X' }, 'Body.'),
    })
    const issues = await vault.validate()
    expect(issues.some((issue) => issue.message.includes('ADR-0001'))).toBe(true)
  })

  it('reports a superseded ADR that does not say what replaced it', async () => {
    const { vault } = vaultWith({
      '10-decisions/x.md': composeNote(
        { type: 'adr', id: 'ADR-0002', title: 'X', status: 'superseded' },
        'Body.'
      ),
    })
    const issues = await vault.validate()
    expect(issues.some((issue) => issue.message.includes('does not say what replaced it'))).toBe(
      true
    )
  })

  it('catches identity data that reached disk by another route', async () => {
    // Defence in depth on read as well as write.
    const { vault } = vaultWith({
      '00-inbox/leak.md': composeNote({ type: 'meeting', title: 'Call' }, 'Email: a@b.test'),
    })
    const issues = await vault.validate()
    expect(issues.some((issue) => issue.message.includes('email address'))).toBe(true)
  })

  it('passes a clean vault', async () => {
    const { vault } = vaultWith(BASE)
    expect(await vault.validate()).toEqual([])
  })
})

describe('slugify', () => {
  it('produces a filesystem-safe name that still reads as the title', () => {
    expect(slugify('Content hashes over mtime')).toBe('content-hashes-over-mtime')
    expect(slugify('  Spaces & symbols!  ')).toBe('spaces-symbols')
  })

  it('never returns an empty string', () => {
    expect(slugify('!!!')).toBe('untitled')
  })
})

describe('templates', () => {
  it('creates an ADR as proposed, never accepted', async () => {
    // Acceptance is a human act; a record that proposes and accepts
    // itself in one step documents nothing.
    const rendered = renderAdr({
      id: 'ADR-0009',
      title: 'Test',
      context: 'c',
      decision: 'd',
      consequences: 'x',
      alternatives: 'a',
    })
    expect(rendered).toContain('status: proposed')
    expect(rendered).toContain('## Alternatives considered')
  })

  it('creates an SOP carrying an owner and a review date', () => {
    const rendered = renderSop({
      title: 'Deploy',
      owner: 'ops',
      appliesWhen: 'w',
      prerequisites: 'p',
      steps: ['First', 'Second'],
      verification: 'v',
      failureModes: 'f',
      escalation: 'e',
    })
    expect(rendered).toContain('owner: ops')
    expect(rendered).toMatch(/lastReviewed: \d{4}-\d{2}-\d{2}/)
    expect(rendered).toContain('1. First')
    expect(rendered).toContain('2. Second')
  })

  it('renders templates that the vault can read back', async () => {
    const { vault } = vaultWith({
      '10-decisions/ADR-0009-test.md': renderAdr({
        id: 'ADR-0009',
        title: 'Test',
        context: 'c',
        decision: 'd',
        consequences: 'x',
        alternatives: 'a',
      }),
    })
    const notes = await vault.notes()
    expect(notes[0]?.frontmatter.id).toBe('ADR-0009')
  })
})
