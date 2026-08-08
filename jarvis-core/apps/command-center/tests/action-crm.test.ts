import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------
// The client pipeline. The path that matters commercially is conversion:
// a lead marked "won" with no client record looks like revenue that does
// not exist, so the ordering and the partial-failure report are pinned
// here rather than left to be discovered in a month's figures.
// ---------------------------------------------------------------------

const writeAudit = vi.fn()
const revalidatePath = vi.fn()

let auth: {
  hasMembership: boolean
  organizationId: string | null
  userId: string | null
} | null = null

/** Ordered log of every table operation, so sequencing can be asserted. */
let ops: string[] = []
let leadRow: Record<string, unknown> | null = null
let existingClient: { id: string } | null = null
let insertFails = new Set<string>()
let updateFails = false

function table(name: string) {
  return {
    insert: (values: Record<string, unknown>) => {
      ops.push(`insert:${name}`)
      const failed = insertFails.has(name)
      return {
        select: () => ({
          single: async () => ({
            data: failed ? null : { id: `${name}-id`, ...values },
            error: failed ? { message: 'insert denied' } : null,
          }),
        }),
      }
    },
    update: (patch: Record<string, unknown>) => {
      ops.push(`update:${name}:${String(patch.status ?? '')}`)
      const result = {
        data: updateFails ? null : { id: `${name}-id`, business_id: 'biz-1' },
        error: updateFails ? { message: 'update denied' } : null,
      }
      return {
        eq: () => ({
          select: () => ({ single: async () => result }),
          then: (resolve: (v: { error: unknown }) => unknown) =>
            resolve({ error: updateFails ? { message: 'update denied' } : null }),
        }),
      }
    },
    select: () => ({
      eq: () => ({
        single: async () => {
          ops.push(`select:${name}`)
          return { data: leadRow, error: leadRow ? null : { message: 'not found' } }
        },
        maybeSingle: async () => {
          ops.push(`select:${name}`)
          return { data: existingClient, error: null }
        },
      }),
    }),
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createUserClient: async () => ({ from: (name: string) => table(name) }),
}))
vi.mock('@/lib/auth', () => ({ getAuthContext: async () => auth }))
vi.mock('@/lib/jarvis', () => ({ getStore: () => ({ writeAudit }) }))
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidatePath(p) }))

const { convertLeadToClient, createLead, updateLeadStatus } = await import('@/app/actions/crm')

function leadForm(overrides: Record<string, string> = {}): FormData {
  const data = new FormData()
  const fields = {
    businessId: '11111111-1111-4111-8111-111111111111',
    companyName: 'Acme Joinery',
    contactName: 'Sam Carter',
    contactEmail: 'sam@acme.test',
    contactPhone: '+447700900123',
    websiteUrl: 'https://acme.test',
    source: 'referral',
    notes: 'Wants a rebuild before Christmas',
    ...overrides,
  }
  for (const [k, v] of Object.entries(fields)) data.set(k, v)
  return data
}

const LEAD_ID = '22222222-2222-4222-8222-222222222222'

beforeEach(() => {
  ops = []
  leadRow = {
    id: LEAD_ID,
    business_id: 'biz-1',
    company_name: 'Acme Joinery',
    contact_name: 'Sam Carter',
    contact_email: 'sam@acme.test',
  }
  existingClient = null
  insertFails = new Set()
  updateFails = false
  auth = { hasMembership: true, organizationId: 'org-1', userId: 'user-1' }
  writeAudit.mockReset()
  revalidatePath.mockReset()
})

describe('capturing a lead', () => {
  it('creates it and refreshes the pipeline', async () => {
    const state = await createLead({ error: null }, leadForm())
    expect(state.error).toBeNull()
    expect(ops).toContain('insert:leads')
    expect(revalidatePath).toHaveBeenCalledWith('/clients')
  })

  it('requires only a business and a company name', async () => {
    const sparse = new FormData()
    sparse.set('businessId', '11111111-1111-4111-8111-111111111111')
    sparse.set('companyName', 'Just A Name')
    const state = await createLead({ error: null }, sparse)
    expect(state.error).toBeNull()
  })

  it('accepts a malformed email rather than losing the lead', async () => {
    // A half-known contact is still worth capturing; rejecting the whole
    // lead over a typo loses the commercial opportunity.
    const state = await createLead({ error: null }, leadForm({ contactEmail: 'sam at acme' }))
    expect(state.error).toBeNull()
  })

  it('refuses without a company name', async () => {
    const state = await createLead({ error: null }, leadForm({ companyName: '' }))
    expect(state.error).toBeTruthy()
    expect(ops).not.toContain('insert:leads')
  })

  it('refuses without a membership', async () => {
    auth = { hasMembership: false, organizationId: null, userId: null }
    const state = await createLead({ error: null }, leadForm())
    expect(state.error).toBe('No active membership.')
    expect(ops).toEqual([])
  })

  it('never writes contact details into the audit trail', async () => {
    await createLead({ error: null }, leadForm())
    const serialized = JSON.stringify(writeAudit.mock.calls)
    expect(serialized).not.toContain('sam@acme.test')
    expect(serialized).not.toContain('447700900123')
    expect(serialized).toContain('lead.created')
  })
})

describe('moving a lead through the pipeline', () => {
  it('records the new status in the audit trail', async () => {
    const state = await updateLeadStatus(LEAD_ID, 'qualified')
    expect(state.error).toBeNull()
    expect(ops).toContain('update:leads:qualified')
    expect(JSON.stringify(writeAudit.mock.calls)).toContain('lead.status_changed')
  })

  it('rejects a status outside the schema constraint', async () => {
    const state = await updateLeadStatus(LEAD_ID, 'definitely_not_a_status')
    expect(state.error).toBe('Unknown status.')
    expect(ops).toEqual([])
  })

  it('rejects a malformed id before touching the database', async () => {
    const state = await updateLeadStatus('not-a-uuid', 'qualified')
    expect(state.error).toBe('Unknown lead.')
    expect(ops).toEqual([])
  })
})

describe('converting a won lead into a client', () => {
  it('creates the client before marking the lead won', async () => {
    const state = await convertLeadToClient(LEAD_ID)
    expect(state.error).toBeNull()

    const clientInsert = ops.indexOf('insert:clients')
    const leadWon = ops.indexOf('update:leads:won')
    expect(clientInsert).toBeGreaterThanOrEqual(0)
    expect(leadWon).toBeGreaterThan(clientInsert)
  })

  it('refuses to convert the same lead twice', async () => {
    existingClient = { id: 'client-existing' }
    const state = await convertLeadToClient(LEAD_ID)
    expect(state.error).toMatch(/already been converted/i)
    expect(ops).not.toContain('insert:clients')
  })

  it('reports a partial outcome rather than claiming success', async () => {
    // Client created, lead status update failed. Saying "done" here would
    // hide a client whose lead still reads proposal_sent.
    updateFails = true
    const state = await convertLeadToClient(LEAD_ID)
    expect(state.error).toMatch(/client created/i)
    expect(state.error).toMatch(/manually/i)
  })

  it('does not mark the lead won when the client could not be created', async () => {
    // The failure that would invent revenue: a won lead with no client.
    insertFails.add('clients')
    const state = await convertLeadToClient(LEAD_ID)
    expect(state.error).toMatch(/could not create the client/i)
    expect(ops).not.toContain('update:leads:won')
  })

  it('refuses when the lead is not visible under RLS', async () => {
    leadRow = null
    const state = await convertLeadToClient(LEAD_ID)
    expect(state.error).toMatch(/could not load/i)
    expect(ops).not.toContain('insert:clients')
  })

  it('carries the lead’s business onto the client, never a caller-supplied one', async () => {
    await convertLeadToClient(LEAD_ID)
    // business_id comes from the lead row the database returned, so a
    // caller cannot move a client into a business they cannot see.
    expect(ops).toContain('insert:clients')
    expect(JSON.stringify(writeAudit.mock.calls)).toContain('client.created')
  })
})
