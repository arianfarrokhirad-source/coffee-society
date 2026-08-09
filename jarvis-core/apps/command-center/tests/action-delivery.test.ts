import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------
// Delivery, and specifically the go-live gate.
//
// public.publish is L4, external, risk high and alwaysApproval — the
// policy already said publishing a client's site is governed. These pin
// that the gate cannot be walked around: no stage change reaches
// `deployed`, and marking a site live requires an APPROVED request whose
// URL is the one that was approved.
// ---------------------------------------------------------------------

const writeAudit = vi.fn()
const createApproval = vi.fn()
const revalidatePath = vi.fn()

let auth: {
  hasMembership: boolean
  organizationId: string | null
  userId: string | null
  authority: string
} | null = null

let ops: string[] = []
let projectRow: Record<string, unknown> | null = null
let proposalRow: Record<string, unknown> | null = null
let clientRow: { id: string } | null = null
let approvalRow: Record<string, unknown> | null = null
let updated: Record<string, unknown> | null = null

function table(name: string) {
  const builder: Record<string, unknown> = {
    insert: (values: Record<string, unknown>) => {
      ops.push(`insert:${name}`)
      return {
        select: () => ({
          single: async () => ({ data: { id: `${name}-1`, ...values }, error: null }),
        }),
      }
    },
    update: (patch: Record<string, unknown>) => {
      ops.push(`update:${name}:${String(patch.status ?? '')}`)
      updated = patch
      return {
        eq: () => ({
          select: () => ({
            single: async () => ({
              data: projectRow ? { id: 'wp-1', business_id: 'biz-1' } : null,
              error: projectRow ? null : { message: 'not found' },
            }),
          }),
        }),
      }
    },
    select: () => {
      const chain = {
        eq: () => chain,
        in: () => chain,
        contains: () => chain,
        limit: async () => ({ data: [], error: null }),
        maybeSingle: async () => {
          ops.push(`select:${name}`)
          if (name === 'clients') return { data: clientRow, error: null }
          if (name === 'approvals') return { data: approvalRow, error: null }
          return { data: null, error: null }
        },
        single: async () => {
          ops.push(`select:${name}`)
          if (name === 'website_projects')
            return { data: projectRow, error: projectRow ? null : { message: 'not found' } }
          if (name === 'proposals')
            return { data: proposalRow, error: proposalRow ? null : { message: 'not found' } }
          return { data: null, error: { message: 'not found' } }
        },
      }
      return chain
    },
  }
  return builder
}

vi.mock('@/lib/supabase/server', () => ({
  createUserClient: async () => ({ from: (n: string) => table(n) }),
}))
vi.mock('@/lib/auth', () => ({ getAuthContext: async () => auth }))
vi.mock('@/lib/jarvis', () => ({ getStore: () => ({ writeAudit, createApproval }) }))
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidatePath(p) }))

const { createWebsiteProject, recordDeployment, requestDeployment, updateProjectStage } =
  await import('@/app/actions/delivery')

const PROJECT_ID = '55555555-5555-4555-8555-555555555555'
const PROPOSAL_ID = '66666666-6666-4666-8666-666666666666'
const LIVE_URL = 'https://acme.example'

beforeEach(() => {
  ops = []
  updated = null
  projectRow = { id: PROJECT_ID, business_id: 'biz-1', name: 'Acme site', status: 'review' }
  proposalRow = { id: PROPOSAL_ID, business_id: 'biz-1', status: 'accepted', lead_id: 'lead-1' }
  clientRow = { id: 'client-1' }
  approvalRow = null
  auth = { hasMembership: true, organizationId: 'org-1', userId: 'user-1', authority: 'L5' }
  writeAudit.mockReset()
  createApproval.mockReset()
  createApproval.mockResolvedValue({ id: 'approval-1' })
  revalidatePath.mockReset()
})

describe('delivery starts from an accepted proposal', () => {
  it('creates the project and links the client through the lead', async () => {
    const form = new FormData()
    form.set('proposalId', PROPOSAL_ID)
    form.set('name', 'Acme Joinery website')

    const state = await createWebsiteProject({ error: null }, form)
    expect(state.error).toBeNull()
    expect(ops).toContain('insert:website_projects')
  })

  it('refuses a proposal that has not been accepted', async () => {
    // A project for a quote nobody agreed to is unpaid work.
    proposalRow = { id: PROPOSAL_ID, business_id: 'biz-1', status: 'sent', lead_id: 'lead-1' }
    const form = new FormData()
    form.set('proposalId', PROPOSAL_ID)
    form.set('name', 'Premature')

    const state = await createWebsiteProject({ error: null }, form)
    expect(state.error).toMatch(/accepted proposal/i)
    expect(ops).not.toContain('insert:website_projects')
  })
})

describe('the go-live gate cannot be walked around', () => {
  it('refuses to reach deployed through an ordinary stage change', async () => {
    const state = await updateProjectStage(PROJECT_ID, 'deployed')
    expect(state.error).toMatch(/approval/i)
    expect(ops).toEqual([])
  })

  it('allows the internal stages freely', async () => {
    for (const stage of ['planning', 'design', 'build', 'review', 'closed']) {
      const state = await updateProjectStage(PROJECT_ID, stage)
      expect(state.error).toBeNull()
    }
  })

  it('rejects a stage outside the schema constraint', async () => {
    const state = await updateProjectStage(PROJECT_ID, 'launched')
    expect(state.error).toBe('Unknown stage.')
  })

  it('raises an approval rather than publishing, even for PRIME at L5', async () => {
    // alwaysApproval means authority does not buy a bypass.
    const state = await requestDeployment(PROJECT_ID, LIVE_URL)
    expect(state.error).toBeNull()
    expect(createApproval).toHaveBeenCalledTimes(1)

    const [input] = createApproval.mock.calls[0] as [Record<string, unknown>]
    expect(input.actionType).toBe('public.publish')
    expect(input.origin).toBe('web')
    expect(input.actionPayload).toEqual({
      website_project_id: PROJECT_ID,
      deployed_url: LIVE_URL,
    })
    // No status change happened.
    expect(ops.some((op) => op.startsWith('update:website_projects'))).toBe(false)
  })

  it('will not mark a site live without an approved request', async () => {
    approvalRow = null
    const state = await recordDeployment(PROJECT_ID)
    expect(state.error).toMatch(/not been approved/i)
    expect(ops.some((op) => op.startsWith('update:website_projects'))).toBe(false)
  })

  it('publishes the URL that was approved, not one supplied later', async () => {
    approvalRow = {
      id: 'approval-1',
      action_payload: { website_project_id: PROJECT_ID, deployed_url: LIVE_URL },
    }
    const state = await recordDeployment(PROJECT_ID, 'https://attacker.example')
    expect(state.error).toBeNull()
    expect(updated?.deployed_url).toBe(LIVE_URL)
    expect(updated?.status).toBe('deployed')
  })
})

describe('the deployment URL is checked before anyone is asked to approve it', () => {
  it.each(['http://acme.example', 'not-a-url', 'ftp://acme.example', ''])(
    'rejects %s',
    async (url) => {
      const state = await requestDeployment(PROJECT_ID, url)
      expect(state.error).toBeTruthy()
      expect(createApproval).not.toHaveBeenCalled()
    }
  )

  it('accepts a valid https URL', async () => {
    const state = await requestDeployment(PROJECT_ID, '  https://acme.example/home  ')
    expect(state.error).toBeNull()
    expect(createApproval).toHaveBeenCalled()
  })
})

describe('guards', () => {
  it('refuses without a membership', async () => {
    auth = { hasMembership: false, organizationId: null, userId: null, authority: 'L0' }
    expect((await requestDeployment(PROJECT_ID, LIVE_URL)).error).toBe('No active membership.')
    expect((await updateProjectStage(PROJECT_ID, 'build')).error).toBe('No active membership.')
  })

  it('refuses when the project is not visible under RLS', async () => {
    projectRow = null
    const state = await requestDeployment(PROJECT_ID, LIVE_URL)
    expect(state.error).toMatch(/could not load/i)
    expect(createApproval).not.toHaveBeenCalled()
  })

  it('does not re-request go-live for a site already live', async () => {
    projectRow = { id: PROJECT_ID, business_id: 'biz-1', name: 'Acme', status: 'deployed' }
    const state = await requestDeployment(PROJECT_ID, LIVE_URL)
    expect(state.error).toMatch(/already live/i)
    expect(createApproval).not.toHaveBeenCalled()
  })

  it('reports a failure to raise the approval rather than silently continuing', async () => {
    createApproval.mockRejectedValue(new Error('rpc denied'))
    const state = await requestDeployment(PROJECT_ID, LIVE_URL)
    expect(state.error).toMatch(/could not raise/i)
  })
})
