import { describe, expect, it } from 'vitest'
import { checkApproval, getActionPolicy, UNKNOWN_ACTION_POLICY } from '../src/policy'

describe('action policy lookup', () => {
  it('unknown action types are treated as restricted (deny-by-default)', () => {
    expect(getActionPolicy('warp.core.eject')).toEqual(UNKNOWN_ACTION_POLICY)
    expect(UNKNOWN_ACTION_POLICY.alwaysApproval).toBe(true)
    expect(UNKNOWN_ACTION_POLICY.minAuthority).toBe('L5')
  })
})

describe('approval requirement logic', () => {
  it('allows a read within authority without approval', () => {
    const result = checkApproval({
      actionType: 'task.read',
      actorAuthority: 'L1',
      actorIsAgent: true,
    })
    expect(result.allowed).toBe(true)
    expect(result.approvalRequired).toBe(false)
  })

  it('an L1 agent creating a task is allowed (task.create is L1)', () => {
    const result = checkApproval({
      actionType: 'task.create',
      actorAuthority: 'L1',
      actorIsAgent: true,
    })
    expect(result.allowed).toBe(true)
  })

  it('an L1 agent updating a task requires approval (task.update is L2)', () => {
    const result = checkApproval({
      actionType: 'task.update',
      actorAuthority: 'L1',
      actorIsAgent: true,
    })
    expect(result.allowed).toBe(false)
    expect(result.approvalRequired).toBe(true)
  })

  it('external actions ALWAYS require approval, even at high authority', () => {
    for (const actionType of [
      'external.execute',
      'client.message',
      'public.publish',
      'finance.execute',
    ]) {
      const result = checkApproval({ actionType, actorAuthority: 'L5', actorIsAgent: false })
      expect(result.approvalRequired, actionType).toBe(true)
    }
  })

  it('restricted requests become approvals — never silent denials or executions', () => {
    const result = checkApproval({
      actionType: 'finance.execute',
      actorAuthority: 'L1',
      actorIsAgent: true,
    })
    expect(result.allowed).toBe(false)
    expect(result.approvalRequired).toBe(true)
    expect(result.risk).toBe('critical')
  })

  it('any cost above the agent financial authority (0) requires approval', () => {
    const result = checkApproval({
      actionType: 'task.create',
      actorAuthority: 'L2',
      actorIsAgent: true,
      estimatedCost: 50,
      maxFinancialAuthority: 0,
    })
    expect(result.allowed).toBe(false)
    expect(result.approvalRequired).toBe(true)
    expect(result.reason).toContain('financial authority')
  })

  it('cost within financial authority passes', () => {
    const result = checkApproval({
      actionType: 'task.create',
      actorAuthority: 'L2',
      actorIsAgent: false,
      estimatedCost: 50,
      maxFinancialAuthority: 100,
    })
    expect(result.allowed).toBe(true)
  })

  it('permission changes always require approval', () => {
    const result = checkApproval({
      actionType: 'permission.change',
      actorAuthority: 'L5',
      actorIsAgent: false,
    })
    expect(result.approvalRequired).toBe(true)
  })
})
