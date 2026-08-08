import { z } from 'zod'
import {
  AGENT_CODES,
  AUTHORITY_LEVELS,
  BUSINESS_CODES,
  PRIORITY_LEVELS,
  RISK_LEVELS,
} from './constants'

// ---------------------------------------------------------------------
// Structured model outputs (section 16). Free text is never trusted for
// orchestration; models must produce output parseable by these schemas.
// Only concise decision rationale is stored — never chain-of-thought.
// ---------------------------------------------------------------------

export const executiveResponseSchema = z.object({
  business: z.enum(BUSINESS_CODES),
  objective: z.string().max(500),
  currentStatus: z.string().max(2000),
  keyFindings: z.array(z.string().max(1000)).max(20),
  financialImpact: z
    .object({
      summary: z.string().max(1000),
      estimatedAmount: z.number().nullable(),
      currency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .nullable(),
    })
    .nullable(),
  risks: z
    .array(
      z.object({
        description: z.string().max(1000),
        level: z.enum(RISK_LEVELS),
      })
    )
    .max(20),
  recommendedActions: z
    .array(
      z.object({
        action: z.string().max(1000),
        priority: z.enum(PRIORITY_LEVELS),
        requiresApproval: z.boolean(),
      })
    )
    .max(20),
  approvalRequired: z.boolean(),
  priority: z.enum(PRIORITY_LEVELS),
  confidence: z.number().min(0).max(1),
  missingInformation: z.array(z.string().max(500)).max(20),
})
export type ExecutiveResponse = z.infer<typeof executiveResponseSchema>

export const taskClassificationSchema = z.object({
  businessCode: z.enum(BUSINESS_CODES),
  intent: z.enum([
    'query',
    'create_task',
    'create_project',
    'record_decision',
    'review_performance',
    'compare_risks',
    'generate_brief',
    'show_approvals',
    'external_action',
    'other',
  ]),
  agentCode: z.enum(AGENT_CODES),
  priority: z.enum(PRIORITY_LEVELS),
  requiredData: z.array(z.string().max(300)).max(20),
  requiredAuthority: z.enum(AUTHORITY_LEVELS),
  externalAction: z.boolean(),
  approvalRequired: z.boolean(),
  reasoningSummary: z.string().max(1000),
})
export type TaskClassification = z.infer<typeof taskClassificationSchema>

// Daily brief structured content (section 20).
export const dailyBriefContentSchema = z.object({
  briefDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  money: z.array(z.string()).default([]),
  threats: z.array(z.string()).default([]),
  opportunities: z.array(z.string()).default([]),
  approvals: z.array(z.string()).default([]),
  todaysPriority: z.array(z.string()).default([]),
  systemHealth: z.array(z.string()).default([]),
})
export type DailyBriefContent = z.infer<typeof dailyBriefContentSchema>
