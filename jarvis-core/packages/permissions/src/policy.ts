import type { AuthorityLevel, RiskLevel } from '@jarvis/shared'
import { meetsAuthority } from './authority'

// ---------------------------------------------------------------------
// Action policy. APPLICATION CODE decides permissions — never the model.
// Every action type flowing through the orchestrator is checked here.
// Unknown action types are treated as restricted (deny-by-default).
// ---------------------------------------------------------------------

export interface ActionPolicy {
  /** Minimum authority to execute directly (without approval). */
  minAuthority: AuthorityLevel
  /** Whether the action leaves the system (external side effect). */
  external: boolean
  /** Whether the action ALWAYS requires PRIME approval regardless of authority. */
  alwaysApproval: boolean
  risk: RiskLevel
}

export const ACTION_POLICIES: Record<string, ActionPolicy> = {
  // Read-only internal
  'business.read': { minAuthority: 'L0', external: false, alwaysApproval: false, risk: 'low' },
  'task.read': { minAuthority: 'L0', external: false, alwaysApproval: false, risk: 'low' },
  'project.read': { minAuthority: 'L0', external: false, alwaysApproval: false, risk: 'low' },
  'objective.read': { minAuthority: 'L0', external: false, alwaysApproval: false, risk: 'low' },
  'decision.read': { minAuthority: 'L0', external: false, alwaysApproval: false, risk: 'low' },
  'approval.read': { minAuthority: 'L0', external: false, alwaysApproval: false, risk: 'low' },
  'document.read': { minAuthority: 'L0', external: false, alwaysApproval: false, risk: 'low' },

  // Internal writes
  'task.create': { minAuthority: 'L1', external: false, alwaysApproval: false, risk: 'low' },
  'task.update': { minAuthority: 'L2', external: false, alwaysApproval: false, risk: 'low' },
  'project.create': { minAuthority: 'L2', external: false, alwaysApproval: false, risk: 'medium' },
  'objective.create': {
    minAuthority: 'L2',
    external: false,
    alwaysApproval: false,
    risk: 'medium',
  },
  'decision.record': { minAuthority: 'L2', external: false, alwaysApproval: false, risk: 'medium' },
  'document.write': { minAuthority: 'L2', external: false, alwaysApproval: false, risk: 'medium' },
  'approval.request': { minAuthority: 'L1', external: false, alwaysApproval: false, risk: 'low' },
  'brief.generate': { minAuthority: 'L2', external: false, alwaysApproval: false, risk: 'low' },

  // Gated
  'approval.resolve': { minAuthority: 'L5', external: false, alwaysApproval: false, risk: 'high' },
  'external.execute': { minAuthority: 'L3', external: true, alwaysApproval: true, risk: 'high' },
  'client.message': { minAuthority: 'L4', external: true, alwaysApproval: true, risk: 'high' },
  'public.publish': { minAuthority: 'L4', external: true, alwaysApproval: true, risk: 'high' },
  'finance.execute': { minAuthority: 'L5', external: true, alwaysApproval: true, risk: 'critical' },
  'integration.connect': { minAuthority: 'L4', external: true, alwaysApproval: true, risk: 'high' },
  'permission.change': {
    minAuthority: 'L5',
    external: false,
    alwaysApproval: true,
    risk: 'critical',
  },
}

/** Deny-by-default policy for unknown action types. */
export const UNKNOWN_ACTION_POLICY: ActionPolicy = {
  minAuthority: 'L5',
  external: true,
  alwaysApproval: true,
  risk: 'critical',
}

export function getActionPolicy(actionType: string): ActionPolicy {
  return ACTION_POLICIES[actionType] ?? UNKNOWN_ACTION_POLICY
}

export interface ApprovalCheckInput {
  actionType: string
  actorAuthority: AuthorityLevel
  /** true when the actor is an AI agent (stricter rules). */
  actorIsAgent: boolean
  estimatedCost?: number | null
  /** Agent's max financial authority (0 for all Phase 1 agents). */
  maxFinancialAuthority?: number
}

export interface ApprovalCheckResult {
  allowed: boolean
  approvalRequired: boolean
  risk: RiskLevel
  reason: string
}

/**
 * Central approval-requirement logic.
 * - Unknown actions: approval always required.
 * - alwaysApproval actions: approval always required.
 * - Insufficient authority: approval required (becomes an approval record,
 *   never a silent execution).
 * - Any cost above the actor's financial authority: approval required.
 * - Agents at L4+ actions: approval required regardless.
 */
export function checkApproval(input: ApprovalCheckInput): ApprovalCheckResult {
  const policy = getActionPolicy(input.actionType)
  const cost = input.estimatedCost ?? 0
  const finAuthority = input.maxFinancialAuthority ?? 0

  if (policy.alwaysApproval) {
    return {
      allowed: false,
      approvalRequired: true,
      risk: policy.risk,
      reason: `Action '${input.actionType}' always requires PRIME approval`,
    }
  }

  if (input.actorIsAgent && !meetsAuthority(input.actorAuthority, policy.minAuthority)) {
    return {
      allowed: false,
      approvalRequired: true,
      risk: policy.risk,
      reason: `Agent authority ${input.actorAuthority} below required ${policy.minAuthority}`,
    }
  }

  if (!input.actorIsAgent && !meetsAuthority(input.actorAuthority, policy.minAuthority)) {
    return {
      allowed: false,
      approvalRequired: true,
      risk: policy.risk,
      reason: `User authority ${input.actorAuthority} below required ${policy.minAuthority}`,
    }
  }

  if (cost > 0 && cost > finAuthority) {
    return {
      allowed: false,
      approvalRequired: true,
      risk: policy.risk === 'low' ? 'medium' : policy.risk,
      reason: `Estimated cost ${cost} exceeds financial authority ${finAuthority}`,
    }
  }

  return { allowed: true, approvalRequired: false, risk: policy.risk, reason: 'Within authority' }
}
