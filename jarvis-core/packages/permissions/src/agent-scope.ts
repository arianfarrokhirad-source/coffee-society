import type { AgentCode, AuthorityLevel, BusinessCode } from '@jarvis/shared'

// ---------------------------------------------------------------------
// Agent scope enforcement. An agent may only act inside its business
// scope and within its allowed action types. Agents NEVER inherit user
// permissions; this check runs server-side on every tool request.
// ---------------------------------------------------------------------

export interface AgentDefinition {
  code: AgentCode
  businessCode: BusinessCode | null // null = org-level (JVS-00)
  authorityLevel: AuthorityLevel
  allowedActionTypes: string[]
  prohibitedActionTypes: string[]
  maxFinancialAuthority: number
  active: boolean
}

export interface AgentActRequest {
  businessCode: BusinessCode | null
  actionType: string
}

export interface AgentScopeResult {
  allowed: boolean
  reason: string
}

export function canAgentAct(agent: AgentDefinition, request: AgentActRequest): AgentScopeResult {
  if (!agent.active) {
    return { allowed: false, reason: `Agent ${agent.code} is inactive` }
  }

  if (agent.prohibitedActionTypes.includes(request.actionType)) {
    return {
      allowed: false,
      reason: `Action '${request.actionType}' is prohibited for agent ${agent.code}`,
    }
  }

  // Business scope: org-level agents (businessCode null) may act across
  // businesses; business agents only inside their own business.
  if (
    agent.businessCode !== null &&
    request.businessCode !== null &&
    agent.businessCode !== request.businessCode
  ) {
    return {
      allowed: false,
      reason: `Agent ${agent.code} is scoped to ${agent.businessCode}, not ${request.businessCode}`,
    }
  }

  if (!agent.allowedActionTypes.includes(request.actionType)) {
    return {
      allowed: false,
      reason: `Action '${request.actionType}' is not in the allowed list for agent ${agent.code}`,
    }
  }

  return { allowed: true, reason: 'Within agent scope' }
}
