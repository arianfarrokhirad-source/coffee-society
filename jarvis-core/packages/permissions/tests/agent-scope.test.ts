import { describe, expect, it } from 'vitest'
import { canAgentAct, type AgentDefinition } from '../src/agent-scope'

const forgeAgent: AgentDefinition = {
  code: 'A01-GM',
  businessCode: 'A01',
  authorityLevel: 'L1',
  allowedActionTypes: ['read_internal', 'draft', 'recommend', 'create_task'],
  prohibitedActionTypes: ['external_side_effect', 'financial_execution', 'client_messaging'],
  maxFinancialAuthority: 0,
  active: true,
}

const orchestrator: AgentDefinition = {
  code: 'JVS-00',
  businessCode: null,
  authorityLevel: 'L1',
  allowedActionTypes: ['classify', 'route', 'summarize', 'read_internal'],
  prohibitedActionTypes: ['external_side_effect', 'financial_execution', 'permission_change'],
  maxFinancialAuthority: 0,
  active: true,
}

describe('agent scope enforcement', () => {
  it('allows an agent to act inside its own business and allowed actions', () => {
    const result = canAgentAct(forgeAgent, { businessCode: 'A01', actionType: 'create_task' })
    expect(result.allowed).toBe(true)
  })

  it('denies cross-business action', () => {
    const result = canAgentAct(forgeAgent, { businessCode: 'A05', actionType: 'create_task' })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('scoped to A01')
  })

  it('denies prohibited actions even if also listed as allowed', () => {
    const contradictory: AgentDefinition = {
      ...forgeAgent,
      allowedActionTypes: [...forgeAgent.allowedActionTypes, 'client_messaging'],
    }
    const result = canAgentAct(contradictory, {
      businessCode: 'A01',
      actionType: 'client_messaging',
    })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('prohibited')
  })

  it('denies actions not in the allowed list', () => {
    const result = canAgentAct(forgeAgent, { businessCode: 'A01', actionType: 'deploy_website' })
    expect(result.allowed).toBe(false)
  })

  it('denies everything for inactive agents', () => {
    const inactive = { ...forgeAgent, active: false }
    const result = canAgentAct(inactive, { businessCode: 'A01', actionType: 'read_internal' })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('inactive')
  })

  it('org-level orchestrator may act across businesses within its allowed actions', () => {
    expect(canAgentAct(orchestrator, { businessCode: 'A01', actionType: 'classify' }).allowed).toBe(
      true
    )
    expect(canAgentAct(orchestrator, { businessCode: 'A06', actionType: 'route' }).allowed).toBe(
      true
    )
    expect(
      canAgentAct(orchestrator, { businessCode: 'A01', actionType: 'external_side_effect' }).allowed
    ).toBe(false)
  })
})
