import { beforeEach, describe, expect, it, vi } from 'vitest'

// Audits are the evidence behind a price. The properties that matter:
// findings keep the object shape the column defaults to, severity uses
// the shared risk scale rather than a second vocabulary, completion is
// one-way, and a proposal can only cite a COMPLETED audit for the SAME
// lead — citing someone else's, or a draft still being edited,
// misrepresents why a client is being charged.

const writeAudit = vi.fn()
const revalidatePath = vi.fn()

let auth: { hasMembership: boolean; organizationId: string | null; userId: string | null } | null =
  null
let ops: string[] = []
let inserted: Record<string, unknown> | null = null
let leadRow: Record<string, unknown> | null = null
let auditRow: Record<string, unknown> | null = null

function table(name: string) {
  return {
    insert: (values: Record<string, unknown>) => {
      ops.push(`insert:${name}`)
      if (name === 'website_audits') inserted = values
      return {
        select: () => ({ single: async () => ({ data: { id: 'audit-1' }, error: null }) }),
      }
    },
    update: (patch: Record<string, unknown>) => {
      ops.push(`update:${name}:${String(patch.status ?? '')}`)
      return {
        eq: () => ({
          then: (resolve: (v: { error: unknown }) => unknown) => resolve({ error: null }),
        }),
      }
    },
    select: () => ({
      eq: () => ({
        single: async () => {
          ops.push(`select:${name}`)
          if (name === 'leads') return { data: leadRow, error: leadRow ? null : { message: 'no' } }
          if (name === 'website_audits')
            return { data: auditRow, error: auditRow ? null : { message: 'no' } }
          return { data: null, error: { message: 'no' } }
        },
        maybeSingle: async () => {
          ops.push(`select:${name}`)
          return { data: auditRow, error: null }
        },
      }),
    }),
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createUserClient: async () => ({ from: (n: string) => table(n) }),
}))
vi.mock('@/lib/auth', () => ({ getAuthContext: async () => auth }))
vi.mock('@/lib/jarvis', () => ({ getStore: () => ({ writeAudit }) }))
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidatePath(p) }))

const { completeAudit, createAudit } = await import('@/app/actions/audits')

const LEAD_ID = '77777777-7777-4777-8777-777777777777'
const AUDIT_ID = '88888888-8888-4888-8888-888888888888'

function auditForm(overrides: Record<string, string> = {}): FormData {
  const data = new FormData()
  const fields: Record<string, string> = {
    leadId: LEAD_ID,
    websiteUrl: '',
    score: '42',
    summary: 'Slow and hard to use on a phone',
    finding_0_area: 'Speed',
    finding_0_issue: 'Loads in 8s on mobile',
    finding_0_severity: 'high',
    finding_1_area: 'SEO',
    finding_1_issue: 'No meta descriptions',
    finding_1_severity: 'medium',
    ...overrides,
  }
  for (const [k, v] of Object.entries(fields)) data.set(k, v)
  return data
}

beforeEach(() => {
  ops = []
  inserted = null
  leadRow = {
    id: LEAD_ID,
    business_id: 'biz-1',
    website_url: 'https://old.example',
    status: 'qualified',
  }
  auditRow = { id: AUDIT_ID, business_id: 'biz-1', status: 'draft' }
  auth = { hasMembership: true, organizationId: 'org-1', userId: 'user-1' }
  writeAudit.mockReset()
  revalidatePath.mockReset()
})

describe('recording an audit', () => {
  it('stores findings inside the object shape the column defaults to', async () => {
    const state = await createAudit({ error: null }, auditForm())
    expect(state.error).toBeNull()

    // The column default is '{}' — an object. Storing a bare array would
    // disagree with the schema's own default.
    const findings = inserted?.findings as { items: unknown[]; summary: string | null }
    expect(Array.isArray(findings.items)).toBe(true)
    expect(findings.items.length).toBe(2)
    expect(findings.summary).toBe('Slow and hard to use on a phone')
  })

  it('falls back to the lead’s website when none is given', async () => {
    await createAudit({ error: null }, auditForm())
    expect(inserted?.website_url).toBe('https://old.example')
  })

  it('takes business scope from the lead row, not the form', async () => {
    await createAudit({ error: null }, auditForm())
    expect(inserted?.business_id).toBe('biz-1')
  })

  it('accepts an audit with no site at all — that is itself a finding', async () => {
    leadRow = { id: LEAD_ID, business_id: 'biz-1', website_url: null, status: 'new' }
    const state = await createAudit({ error: null }, auditForm({ websiteUrl: '' }))
    expect(state.error).toBeNull()
    expect(inserted?.website_url).toBeNull()
  })

  it('rejects a score outside 0–100', async () => {
    expect((await createAudit({ error: null }, auditForm({ score: '150' }))).error).toBeTruthy()
    expect((await createAudit({ error: null }, auditForm({ score: '-5' }))).error).toBeTruthy()
  })

  it('requires at least one finding', async () => {
    const bare = new FormData()
    bare.set('leadId', LEAD_ID)
    bare.set('score', '50')
    const state = await createAudit({ error: null }, bare)
    expect(state.error).toMatch(/finding/i)
    expect(ops).not.toContain('insert:website_audits')
  })

  it('skips blank finding rows without complaining', async () => {
    const state = await createAudit({ error: null }, auditForm({ finding_3_issue: '' }))
    expect(state.error).toBeNull()
    expect((inserted?.findings as { items: unknown[] }).items.length).toBe(2)
  })

  it('defaults a missing severity to medium rather than dropping the finding', async () => {
    const state = await createAudit({ error: null }, auditForm({ finding_1_severity: '' }))
    expect(state.error).toBeNull()
    const items = (inserted?.findings as { items: { severity: string }[] }).items
    expect(items[1]?.severity).toBe('medium')
  })

  it('moves the lead to audit_scheduled', async () => {
    await createAudit({ error: null }, auditForm())
    expect(ops).toContain('update:leads:audit_scheduled')
  })

  it('leaves a lead further along the funnel alone', async () => {
    leadRow = { ...leadRow, status: 'proposal_sent' }
    await createAudit({ error: null }, auditForm())
    expect(ops.some((op) => op.startsWith('update:leads'))).toBe(false)
  })

  it('refuses when the lead is not visible under RLS', async () => {
    leadRow = null
    const state = await createAudit({ error: null }, auditForm())
    expect(state.error).toMatch(/could not load/i)
    expect(ops).not.toContain('insert:website_audits')
  })

  it('refuses without a membership', async () => {
    auth = { hasMembership: false, organizationId: null, userId: null }
    const state = await createAudit({ error: null }, auditForm())
    expect(state.error).toBe('No active membership.')
    expect(ops).toEqual([])
  })
})

describe('completion is one-way', () => {
  it('completes a draft', async () => {
    const state = await completeAudit(AUDIT_ID)
    expect(state.error).toBeNull()
    expect(ops).toContain('update:website_audits:completed')
  })

  it('refuses to complete twice', async () => {
    // An audit is evidence a client was shown; re-finishing it invites
    // editing the justification for a price they already saw.
    auditRow = { id: AUDIT_ID, business_id: 'biz-1', status: 'completed' }
    const state = await completeAudit(AUDIT_ID)
    expect(state.error).toMatch(/already completed/i)
  })

  it('rejects a malformed id before touching the database', async () => {
    const state = await completeAudit('not-a-uuid')
    expect(state.error).toBe('Unknown audit.')
    expect(ops).toEqual([])
  })
})
