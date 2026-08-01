import { describe, expect, it } from 'vitest'
import {
  dailyBriefContentSchema,
  executiveResponseSchema,
  taskClassificationSchema,
} from '../src/schemas'

describe('executive response schema', () => {
  const valid = {
    business: 'A01',
    objective: 'Grow pilot revenue',
    currentStatus: 'Two proposals in draft',
    keyFindings: ['Lead volume is low'],
    financialImpact: { summary: 'Pipeline ~2k EUR', estimatedAmount: 2000, currency: 'EUR' },
    risks: [{ description: 'Single lead source', level: 'medium' }],
    recommendedActions: [
      { action: 'Prepare dental clinic proposal', priority: 'P1', requiresApproval: false },
    ],
    approvalRequired: false,
    priority: 'P1',
    confidence: 0.8,
    missingInformation: [],
  }

  it('accepts a valid executive response', () => {
    expect(executiveResponseSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects unknown business codes', () => {
    expect(executiveResponseSchema.safeParse({ ...valid, business: 'A99' }).success).toBe(false)
  })

  it('rejects out-of-range confidence', () => {
    expect(executiveResponseSchema.safeParse({ ...valid, confidence: 1.5 }).success).toBe(false)
  })

  it('rejects malformed currency', () => {
    expect(
      executiveResponseSchema.safeParse({
        ...valid,
        financialImpact: { summary: 'x', estimatedAmount: 1, currency: 'euros' },
      }).success
    ).toBe(false)
  })
})

describe('task classification schema', () => {
  const valid = {
    businessCode: 'A01',
    intent: 'create_task',
    agentCode: 'A01-GM',
    priority: 'P2',
    requiredData: [],
    requiredAuthority: 'L1',
    externalAction: false,
    approvalRequired: false,
    reasoningSummary: 'User asked to create a FORGE task.',
  }

  it('accepts a valid classification', () => {
    expect(taskClassificationSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects invalid intents and agent codes', () => {
    expect(taskClassificationSchema.safeParse({ ...valid, intent: 'rm_rf' }).success).toBe(false)
    expect(taskClassificationSchema.safeParse({ ...valid, agentCode: 'A99-GM' }).success).toBe(
      false
    )
  })

  it('rejects oversized reasoning (no chain-of-thought storage)', () => {
    expect(
      taskClassificationSchema.safeParse({ ...valid, reasoningSummary: 'x'.repeat(1001) }).success
    ).toBe(false)
  })
})

describe('daily brief content schema', () => {
  it('accepts a structured brief and applies defaults', () => {
    const parsed = dailyBriefContentSchema.parse({ briefDate: '2026-08-01' })
    expect(parsed.money).toEqual([])
    expect(parsed.systemHealth).toEqual([])
  })

  it('rejects malformed dates', () => {
    expect(dailyBriefContentSchema.safeParse({ briefDate: 'yesterday' }).success).toBe(false)
  })
})
