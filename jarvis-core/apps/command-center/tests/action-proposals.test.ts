import { beforeEach, describe, expect, it, vi } from 'vitest'

// The money path. Two properties are load-bearing: the total is derived
// from the line items rather than accepted from the browser, and the
// business comes from the lead the database returned rather than the
// form — otherwise a caller could quote against a business they cannot
// see, or send a total that disagrees with its own lines.

const writeAudit = vi.fn()
const revalidatePath = vi.fn()

let auth: { hasMembership: boolean; organizationId: string | null; userId: string | null } | null =
  null
let ops: string[] = []
let inserted: Record<string, unknown> | null = null
let leadRow: Record<string, unknown> | null = null
let proposalRow: Record<string, unknown> | null = null
let insertFails = false
let leadUpdateFails = false

function table(name: string) {
  return {
    insert: (values: Record<string, unknown>) => {
      ops.push(`insert:${name}`)
      if (name === 'proposals') inserted = values
      return {
        select: () => ({
          single: async () => ({
            data: insertFails ? null : { id: 'proposal-1' },
            error: insertFails ? { message: 'denied' } : null,
          }),
        }),
      }
    },
    update: (patch: Record<string, unknown>) => {
      ops.push(`update:${name}:${String(patch.status ?? '')}`)
      const failed = name === 'leads' && leadUpdateFails
      return {
        eq: () => ({
          select: () => ({
            single: async () => ({
              data: proposalRow,
              error: proposalRow ? null : { message: 'not found' },
            }),
          }),
          then: (resolve: (v: { error: unknown }) => unknown) =>
            resolve({ error: failed ? { message: 'denied' } : null }),
        }),
      }
    },
    select: () => ({
      eq: () => ({
        single: async () => {
          ops.push(`select:${name}`)
          return { data: leadRow, error: leadRow ? null : { message: 'not found' } }
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

const { createProposal, updateProposalStatus } = await import('@/app/actions/crm')

const LEAD_ID = '33333333-3333-4333-8333-333333333333'
const PROPOSAL_ID = '44444444-4444-4444-8444-444444444444'

function proposalForm(overrides: Record<string, string> = {}): FormData {
  const data = new FormData()
  const fields: Record<string, string> = {
    leadId: LEAD_ID,
    title: 'Website rebuild',
    summary: 'Five pages plus hosting',
    currency: 'EUR',
    item_0_description: 'Design and build',
    item_0_amount: '2500.50',
    item_1_description: 'Hosting, first year',
    item_1_amount: '300',
    ...overrides,
  }
  for (const [k, v] of Object.entries(fields)) data.set(k, v)
  return data
}

beforeEach(() => {
  ops = []
  inserted = null
  insertFails = false
  leadUpdateFails = false
  leadRow = { id: LEAD_ID, business_id: 'biz-1' }
  proposalRow = { id: PROPOSAL_ID, business_id: 'biz-1', lead_id: LEAD_ID }
  auth = { hasMembership: true, organizationId: 'org-1', userId: 'user-1' }
  writeAudit.mockReset()
  revalidatePath.mockReset()
})

describe('the total is derived, never submitted', () => {
  it('sums the line items server-side', async () => {
    const state = await createProposal({ error: null }, proposalForm())
    expect(state.error).toBeNull()
    expect(inserted?.total_amount).toBeCloseTo(2800.5)
    expect((inserted?.line_items as unknown[]).length).toBe(2)
  })

  it('ignores a total supplied by the browser', async () => {
    // A submitted total that disagrees with its own lines is how a quote
    // goes out wrong. The field is simply not read.
    const state = await createProposal(
      { error: null },
      proposalForm({ total_amount: '1', totalAmount: '1' })
    )
    expect(state.error).toBeNull()
    expect(inserted?.total_amount).toBeCloseTo(2800.5)
  })

  it('skips blank spare rows without complaining', async () => {
    const form = proposalForm({ item_4_description: '', item_4_amount: '' })
    const state = await createProposal({ error: null }, form)
    expect(state.error).toBeNull()
    expect((inserted?.line_items as unknown[]).length).toBe(2)
  })

  it('treats a non-numeric amount as zero rather than dropping the line', async () => {
    const state = await createProposal(
      { error: null },
      proposalForm({ item_1_amount: 'about three hundred' })
    )
    expect(state.error).toBeNull()
    expect(inserted?.total_amount).toBeCloseTo(2500.5)
    expect((inserted?.line_items as unknown[]).length).toBe(2)
  })

  it('refuses a proposal with no line items at all', async () => {
    const bare = new FormData()
    bare.set('leadId', LEAD_ID)
    bare.set('title', 'Empty')
    bare.set('currency', 'EUR')
    const state = await createProposal({ error: null }, bare)
    expect(state.error).toMatch(/line item/i)
    expect(ops).not.toContain('insert:proposals')
  })
})

describe('scope comes from the database, not the form', () => {
  it('takes business_id from the lead row', async () => {
    await createProposal({ error: null }, proposalForm())
    expect(inserted?.business_id).toBe('biz-1')
  })

  it('refuses when the lead is not visible under RLS', async () => {
    leadRow = null
    const state = await createProposal({ error: null }, proposalForm())
    expect(state.error).toMatch(/could not load/i)
    expect(ops).not.toContain('insert:proposals')
  })

  it('refuses without a membership', async () => {
    auth = { hasMembership: false, organizationId: null, userId: null }
    const state = await createProposal({ error: null }, proposalForm())
    expect(state.error).toBe('No active membership.')
    expect(ops).toEqual([])
  })

  it('rejects a currency that is not a three-letter code', async () => {
    const state = await createProposal({ error: null }, proposalForm({ currency: 'euros' }))
    expect(state.error).toBeTruthy()
    expect(ops).not.toContain('insert:proposals')
  })
})

describe('proposal lifecycle', () => {
  it('moves the lead to proposal_sent when the proposal is sent', async () => {
    // The pipeline board and the proposal list must not disagree.
    const state = await updateProposalStatus(PROPOSAL_ID, 'sent')
    expect(state.error).toBeNull()
    expect(ops).toContain('update:proposals:sent')
    expect(ops).toContain('update:leads:proposal_sent')
  })

  it('does not touch the lead for any other status', async () => {
    await updateProposalStatus(PROPOSAL_ID, 'accepted')
    expect(ops).toContain('update:proposals:accepted')
    expect(ops.some((op) => op.startsWith('update:leads'))).toBe(false)
  })

  it('still reports success when only the lead sync fails', async () => {
    // The proposal did move; failing the whole call would misreport it.
    leadUpdateFails = true
    const state = await updateProposalStatus(PROPOSAL_ID, 'sent')
    expect(state.error).toBeNull()
  })

  it('rejects a status outside the schema constraint', async () => {
    const state = await updateProposalStatus(PROPOSAL_ID, 'invoiced')
    expect(state.error).toBe('Unknown status.')
    expect(ops).toEqual([])
  })

  it('refuses when the proposal is not visible under RLS', async () => {
    proposalRow = null
    const state = await updateProposalStatus(PROPOSAL_ID, 'sent')
    expect(state.error).toMatch(/could not update/i)
  })

  it('records the status change in the audit trail', async () => {
    await updateProposalStatus(PROPOSAL_ID, 'accepted')
    expect(JSON.stringify(writeAudit.mock.calls)).toContain('proposal.status_changed')
  })
})
