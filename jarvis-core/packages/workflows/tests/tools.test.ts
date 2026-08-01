import { beforeEach, describe, expect, it } from 'vitest'
import { createInMemoryStore } from '@jarvis/database'
import type { AgentDefinition } from '@jarvis/permissions'
import { createInMemoryRateLimiter } from '@jarvis/security'
import { executeTool, type ToolContext } from '../src/tools'

type Store = ReturnType<typeof createInMemoryStore>

let store: Store
let forgeBusinessId: string
let forgeAgent: AgentDefinition
let forgeAgentId: string

beforeEach(async () => {
  store = createInMemoryStore()
  const forge = await store.getBusinessByCode('A01')
  const agentRow = await store.getAgentByCode('A01-GM')
  forgeBusinessId = forge!.id
  forgeAgentId = agentRow!.id
  forgeAgent = {
    code: 'A01-GM',
    businessCode: 'A01',
    authorityLevel: 'L1',
    allowedActionTypes: agentRow!.allowed_action_types,
    prohibitedActionTypes: agentRow!.prohibited_action_types,
    maxFinancialAuthority: 0,
    active: true,
  }
})

function agentCtx(overrides?: Partial<ToolContext>): ToolContext {
  return {
    store,
    organizationId: store.state.organizationId,
    businessId: forgeBusinessId,
    businessCode: 'A01',
    actor: {
      type: 'agent',
      id: forgeAgentId,
      authority: 'L1',
      agent: forgeAgent,
      onBehalfOfProfileId: 'profile-1',
    },
    requestId: 'req-1',
    ...overrides,
  }
}

function userCtx(authority: 'L0' | 'L5' = 'L5'): ToolContext {
  return {
    store,
    organizationId: store.state.organizationId,
    businessId: forgeBusinessId,
    businessCode: 'A01',
    actor: { type: 'user', id: 'profile-1', authority },
    requestId: 'req-2',
  }
}

describe('tool pipeline — happy paths', () => {
  it('agent within scope can create a task, and it is audited', async () => {
    const outcome = await executeTool(agentCtx(), 'createTask', {
      title: 'Audit dental clinic site',
    })
    expect(outcome.status).toBe('executed')
    expect(store.state.tasks).toHaveLength(1)
    expect(store.state.tasks[0]?.created_by_agent_id).toBe(forgeAgentId)
    expect(
      store.state.toolCalls.some((c) => c.toolName === 'createTask' && c.status === 'executed')
    ).toBe(true)
    expect(store.state.auditEvents.some((e) => e.action === 'tool.executed')).toBe(true)
  })

  it('reads work for both users and agents', async () => {
    expect((await executeTool(agentCtx(), 'getOpenTasks', {})).status).toBe('executed')
    expect((await executeTool(userCtx(), 'getPendingApprovals', {})).status).toBe('executed')
  })
})

describe('tool pipeline — enforcement', () => {
  it('denies unknown tools and audits the denial', async () => {
    const outcome = await executeTool(agentCtx(), 'dropDatabase', {})
    expect(outcome.status).toBe('denied')
    expect(store.state.auditEvents.some((e) => e.action === 'permission.denied')).toBe(true)
  })

  it('denies invalid arguments', async () => {
    const outcome = await executeTool(agentCtx(), 'createTask', { title: '' })
    expect(outcome.status).toBe('denied')
    if (outcome.status === 'denied') expect(outcome.reason).toContain('Invalid arguments')
  })

  it('denies out-of-scope business for a scoped agent', async () => {
    const tempo = await store.getBusinessByCode('A05')
    const outcome = await executeTool(
      agentCtx({ businessId: tempo!.id, businessCode: 'A05' }),
      'createTask',
      { title: 'cross-business write' }
    )
    expect(outcome.status).toBe('denied')
    if (outcome.status === 'denied') expect(outcome.reason).toContain('scoped to A01')
    expect(store.state.tasks).toHaveLength(0)
  })

  it('an L1 agent requesting task.update gets an APPROVAL, not execution', async () => {
    const task = await store.createTask({
      organizationId: store.state.organizationId,
      businessId: forgeBusinessId,
      title: 'existing',
    })
    const outcome = await executeTool(agentCtx(), 'updateTask', { taskId: task.id, status: 'done' })
    expect(outcome.status).toBe('approval_created')
    expect(store.state.approvals).toHaveLength(1)
    expect(store.state.approvals[0]?.action_type).toBe('task.update')
    expect(store.state.approvals[0]?.requested_by_agent_id).toBe(forgeAgentId)
    // the task was NOT modified
    expect(store.state.tasks[0]?.status).toBe('todo')
    expect(store.state.auditEvents.some((e) => e.action === 'approval.requested')).toBe(true)
  })

  it('an L0 user cannot create tasks (task.create requires L1) — approval is created', async () => {
    const outcome = await executeTool(userCtx('L0'), 'createTask', { title: 'sneaky' })
    expect(outcome.status).toBe('approval_created')
    expect(store.state.tasks).toHaveLength(0)
  })

  it('rate limiting denies excess calls', async () => {
    const limiter = createInMemoryRateLimiter({ windowMs: 60_000, maxRequests: 1 })
    const ctx = agentCtx({ rateLimiter: limiter })
    expect((await executeTool(ctx, 'getOpenTasks', {})).status).toBe('executed')
    const second = await executeTool(ctx, 'getOpenTasks', {})
    expect(second.status).toBe('denied')
  })

  it('tool failures are recorded, not thrown', async () => {
    const outcome = await executeTool(
      agentCtx({ businessId: null, businessCode: null }),
      'getBusinessSummary',
      {}
    )
    // JVS-scope agent guard: business scope required → failure captured
    expect(['failed', 'denied']).toContain(outcome.status)
    expect(store.state.toolCalls.some((c) => c.status === 'failed' || c.status === 'denied')).toBe(
      true
    )
  })
})

describe('approval requests', () => {
  it('an agent may file an approval request explicitly', async () => {
    const outcome = await executeTool(agentCtx(), 'requestApproval', {
      actionType: 'external.execute',
      reason: 'Send proposal to client',
      riskLevel: 'high',
    })
    expect(outcome.status).toBe('executed')
    expect(store.state.approvals).toHaveLength(1)
    expect(store.state.approvals[0]?.status).toBe('pending')
  })
})
