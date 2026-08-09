import { beforeEach, describe, expect, it, vi } from 'vitest'

// Maintenance plans are recurring revenue. The properties that matter
// are the ones that would otherwise corrupt a revenue figure: scope
// taken from the database rather than the form, a linked site that
// really belongs to the paying client, and a cancellation that stays
// cancelled so churn stays measurable.

const writeAudit = vi.fn()
const revalidatePath = vi.fn()

let auth: { hasMembership: boolean; organizationId: string | null; userId: string | null } | null =
  null
let ops: string[] = []
let inserted: Record<string, unknown> | null = null
let clientRow: Record<string, unknown> | null = null
let projectRow: Record<string, unknown> | null = null
let planRow: Record<string, unknown> | null = null
let updateFails = false

function table(name: string) {
  return {
    insert: (values: Record<string, unknown>) => {
      ops.push(`insert:${name}`)
      inserted = values
      return {
        select: () => ({ single: async () => ({ data: { id: 'plan-1' }, error: null }) }),
      }
    },
    update: (patch: Record<string, unknown>) => {
      ops.push(`update:${name}:${String(patch.status ?? '')}`)
      return {
        eq: () => ({
          then: (resolve: (v: { error: unknown }) => unknown) =>
            resolve({ error: updateFails ? { message: 'denied' } : null }),
        }),
      }
    },
    select: () => ({
      eq: () => ({
        single: async () => {
          ops.push(`select:${name}`)
          if (name === 'clients') {
            return { data: clientRow, error: clientRow ? null : { message: 'no' } }
          }
          if (name === 'website_projects') {
            return { data: projectRow, error: projectRow ? null : { message: 'no' } }
          }
          if (name === 'maintenance_plans') {
            return { data: planRow, error: planRow ? null : { message: 'no' } }
          }
          return { data: null, error: { message: 'no' } }
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

const { createMaintenancePlan, updateMaintenanceStatus } = await import('@/app/actions/maintenance')

const CLIENT_ID = '11111111-1111-4111-8111-111111111111'
const PROJECT_ID = '22222222-2222-4222-8222-222222222222'
const PLAN_ID = '33333333-3333-4333-8333-333333333333'

function planForm(overrides: Record<string, string> = {}): FormData {
  const data = new FormData()
  const fields: Record<string, string> = {
    clientId: CLIENT_ID,
    websiteProjectId: '',
    name: 'Hosting, updates and backups',
    monthlyAmount: '400',
    currency: 'EUR',
    ...overrides,
  }
  for (const [k, v] of Object.entries(fields)) data.set(k, v)
  return data
}

beforeEach(() => {
  ops = []
  inserted = null
  clientRow = { id: CLIENT_ID, business_id: 'biz-1', company_name: 'Acme Joinery' }
  projectRow = { id: PROJECT_ID, client_id: CLIENT_ID }
  planRow = { id: PLAN_ID, business_id: 'biz-1', status: 'active' }
  updateFails = false
  auth = { hasMembership: true, organizationId: 'org-1', userId: 'user-1' }
  writeAudit.mockReset()
  revalidatePath.mockReset()
})

describe('starting a plan', () => {
  it('creates an active plan and refreshes the page', async () => {
    const state = await createMaintenancePlan({ error: null }, planForm())
    expect(state.error).toBeNull()
    expect(ops).toContain('insert:maintenance_plans')
    expect(inserted?.status).toBe('active')
    expect(revalidatePath).toHaveBeenCalledWith('/maintenance')
  })

  it('takes business scope from the client row, never the form', async () => {
    // A caller must not be able to file a plan against a business they
    // cannot see.
    const form = planForm()
    form.set('businessId', 'biz-attacker')
    await createMaintenancePlan({ error: null }, form)
    expect(inserted?.business_id).toBe('biz-1')
  })

  it('stores the amount and currency as given', async () => {
    await createMaintenancePlan(
      { error: null },
      planForm({ monthlyAmount: '250.50', currency: 'GBP' })
    )
    expect(inserted?.monthly_amount).toBe(250.5)
    expect(inserted?.currency).toBe('GBP')
  })

  it('defaults currency to EUR', async () => {
    await createMaintenancePlan({ error: null }, planForm({ currency: '' }))
    expect(inserted?.currency).toBe('EUR')
  })

  it('rejects a currency that is not a three-letter code', async () => {
    const state = await createMaintenancePlan({ error: null }, planForm({ currency: 'euro' }))
    expect(state.error).toBeTruthy()
    expect(ops).not.toContain('insert:maintenance_plans')
  })

  it('rejects a negative amount', async () => {
    // The schema's own check constraint, enforced before the round trip.
    const state = await createMaintenancePlan({ error: null }, planForm({ monthlyAmount: '-10' }))
    expect(state.error).toBeTruthy()
    expect(ops).not.toContain('insert:maintenance_plans')
  })

  it('allows a zero-amount plan', async () => {
    // A goodwill or bundled retainer is a real arrangement worth tracking.
    const state = await createMaintenancePlan({ error: null }, planForm({ monthlyAmount: '0' }))
    expect(state.error).toBeNull()
    expect(inserted?.monthly_amount).toBe(0)
  })

  it('requires a name', async () => {
    const state = await createMaintenancePlan({ error: null }, planForm({ name: '   ' }))
    expect(state.error).toBeTruthy()
    expect(ops).not.toContain('insert:maintenance_plans')
  })

  it('creates a plan with no linked site', async () => {
    // An inherited site still needs maintaining; refusing would turn
    // away revenue the schema is happy to hold.
    const state = await createMaintenancePlan({ error: null }, planForm({ websiteProjectId: '' }))
    expect(state.error).toBeNull()
    expect(inserted?.website_project_id).toBeNull()
    expect(ops).not.toContain('select:website_projects')
  })

  it('links a site belonging to the same client', async () => {
    const state = await createMaintenancePlan(
      { error: null },
      planForm({ websiteProjectId: PROJECT_ID })
    )
    expect(state.error).toBeNull()
    expect(inserted?.website_project_id).toBe(PROJECT_ID)
  })

  it('refuses a site belonging to a different client', async () => {
    // Otherwise the first anyone notices is a support request answered
    // against the wrong website.
    projectRow = { id: PROJECT_ID, client_id: 'someone-else' }
    const state = await createMaintenancePlan(
      { error: null },
      planForm({ websiteProjectId: PROJECT_ID })
    )
    expect(state.error).toMatch(/different client/i)
    expect(ops).not.toContain('insert:maintenance_plans')
  })

  it('refuses when the client is not visible under RLS', async () => {
    clientRow = null
    const state = await createMaintenancePlan({ error: null }, planForm())
    expect(state.error).toMatch(/could not load/i)
    expect(ops).not.toContain('insert:maintenance_plans')
  })

  it('refuses without a membership', async () => {
    auth = { hasMembership: false, organizationId: null, userId: null }
    const state = await createMaintenancePlan({ error: null }, planForm())
    expect(state.error).toBe('No active membership.')
    expect(ops).toEqual([])
  })

  it('records the commercial terms in the audit trail', async () => {
    await createMaintenancePlan({ error: null }, planForm())
    const serialised = JSON.stringify(writeAudit.mock.calls)
    expect(serialised).toContain('maintenance_plan.created')
    expect(serialised).toContain('400.00')
    // Amount and currency are commercial terms, not identity data.
    expect(serialised).not.toContain('Acme Joinery')
  })
})

describe('the plan lifecycle', () => {
  it('pauses an active plan', async () => {
    const state = await updateMaintenanceStatus(PLAN_ID, 'paused')
    expect(state.error).toBeNull()
    expect(ops).toContain('update:maintenance_plans:paused')
  })

  it('resumes a paused plan', async () => {
    planRow = { id: PLAN_ID, business_id: 'biz-1', status: 'paused' }
    const state = await updateMaintenanceStatus(PLAN_ID, 'active')
    expect(state.error).toBeNull()
    expect(ops).toContain('update:maintenance_plans:active')
  })

  it('cancels an active plan', async () => {
    const state = await updateMaintenanceStatus(PLAN_ID, 'cancelled')
    expect(state.error).toBeNull()
    expect(ops).toContain('update:maintenance_plans:cancelled')
  })

  it('treats cancellation as terminal', async () => {
    // A cancelled retainer that can be silently reactivated makes churn
    // unmeasurable — nobody could tell a correction from a win.
    planRow = { id: PLAN_ID, business_id: 'biz-1', status: 'cancelled' }
    const state = await updateMaintenanceStatus(PLAN_ID, 'active')
    expect(state.error).toMatch(/cancelled/i)
    expect(ops.some((op) => op.startsWith('update:'))).toBe(false)
  })

  it('refuses a no-op transition', async () => {
    const state = await updateMaintenanceStatus(PLAN_ID, 'active')
    expect(state.error).toMatch(/already active/i)
    expect(ops.some((op) => op.startsWith('update:'))).toBe(false)
  })

  it('rejects a status outside the schema constraint', async () => {
    const state = await updateMaintenanceStatus(PLAN_ID, 'churned')
    expect(state.error).toBe('Unknown status.')
    expect(ops).toEqual([])
  })

  it('rejects a malformed id before touching the database', async () => {
    const state = await updateMaintenanceStatus('not-a-uuid', 'paused')
    expect(state.error).toBe('Unknown plan.')
    expect(ops).toEqual([])
  })

  it('refuses when the plan is not visible under RLS', async () => {
    planRow = null
    const state = await updateMaintenanceStatus(PLAN_ID, 'paused')
    expect(state.error).toMatch(/could not load/i)
  })

  it('reports a failed update rather than claiming success', async () => {
    updateFails = true
    const state = await updateMaintenanceStatus(PLAN_ID, 'paused')
    expect(state.error).toBeTruthy()
  })

  it('records the transition in the audit trail', async () => {
    await updateMaintenanceStatus(PLAN_ID, 'paused')
    const serialised = JSON.stringify(writeAudit.mock.calls)
    expect(serialised).toContain('maintenance_plan.status_changed')
    expect(serialised).toContain('paused')
  })

  it('refuses without a membership', async () => {
    auth = { hasMembership: false, organizationId: null, userId: null }
    const state = await updateMaintenanceStatus(PLAN_ID, 'paused')
    expect(state.error).toBe('No active membership.')
    expect(ops).toEqual([])
  })
})
