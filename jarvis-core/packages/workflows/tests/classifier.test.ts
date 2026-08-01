import { describe, expect, it } from 'vitest'
import { classifyDeterministic, classifyRequest, detectBusinessCode } from '../src/classifier'

describe('business detection', () => {
  it('detects codes and names', () => {
    expect(detectBusinessCode('review A01 performance')).toBe('A01')
    expect(detectBusinessCode('create a task for FORGE')).toBe('A01')
    expect(detectBusinessCode('what about tempo?')).toBe('A05')
    expect(detectBusinessCode('random text')).toBeNull()
  })

  it('does not match ECHO inside other words', () => {
    expect(detectBusinessCode('the echoes of history')).toBeNull()
  })
})

describe('deterministic command classification', () => {
  it('classifies "Show my pending approvals"', () => {
    const c = classifyDeterministic('Show my pending approvals.')
    expect(c?.intent).toBe('show_approvals')
    expect(c?.agentCode).toBe('JVS-00')
  })

  it('classifies "Review A01 performance"', () => {
    const c = classifyDeterministic('Review A01 performance.')
    expect(c?.intent).toBe('review_performance')
    expect(c?.businessCode).toBe('A01')
    expect(c?.agentCode).toBe('A01-GM')
  })

  it('classifies FORGE task creation with payload', () => {
    const c = classifyDeterministic('Create a task for FORGE to prepare a dental clinic proposal.')
    expect(c?.intent).toBe('create_task')
    expect(c?.businessCode).toBe('A01')
    expect(c?.requiredData[0]).toContain('dental clinic')
  })

  it('classifies cross-business risk comparison', () => {
    const c = classifyDeterministic('Compare current project risks across all active businesses.')
    expect(c?.intent).toBe('compare_risks')
    expect(c?.agentCode).toBe('A00-GM')
  })

  it('classifies the PRIME brief request', () => {
    const c = classifyDeterministic("Generate today's PRIME brief.")
    expect(c?.intent).toBe('generate_brief')
  })

  it('flags external side effects as approval-required', () => {
    const c = classifyDeterministic('Send the proposal email to the dental clinic')
    expect(c?.intent).toBe('external_action')
    expect(c?.externalAction).toBe(true)
    expect(c?.approvalRequired).toBe(true)
    expect(c?.requiredAuthority).toBe('L4')
  })

  it('returns null for free-form requests (model territory)', () => {
    expect(classifyDeterministic('What should our five year vision be?')).toBeNull()
  })
})

describe('classifyRequest fallback', () => {
  it('falls back to a safe read-only query without a router', async () => {
    const { classification, source } = await classifyRequest('What should our vision be?', null)
    expect(source).toBe('fallback')
    expect(classification.intent).toBe('query')
    expect(classification.externalAction).toBe(false)
    expect(classification.requiredAuthority).toBe('L0')
  })

  it('uses rules first even when a router exists', async () => {
    const { source } = await classifyRequest('Show my pending approvals', {
      resolveRoute: () => {
        throw new Error('router must not be called')
      },
      complete: () => {
        throw new Error('router must not be called')
      },
      availableProviders: () => [],
    })
    expect(source).toBe('rules')
  })
})
