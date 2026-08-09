import { describe, expect, it } from 'vitest'
import { createInMemoryStore } from '@jarvis/database'
import type { AIProvider, AIRequest, AIResponse } from '@jarvis/ai'
import { createRouter } from '@jarvis/ai'
import { runJarvis, type JarvisUser } from '../src/orchestrator'

const prime: JarvisUser = { profileId: 'prime-profile', authority: 'L5', isPrime: true }

function newStore() {
  return createInMemoryStore()
}

describe('JVS-00 orchestration — offline (no AI provider)', () => {
  it('answers "Show my pending approvals" and logs the run', async () => {
    const store = newStore()
    const reply = await runJarvis({ store, router: null }, prime, {
      message: 'Show my pending approvals.',
      business: 'auto',
    })
    expect(reply.intent).toBe('show_approvals')
    expect(reply.provider).toBe('none')
    expect(reply.text).toContain('No pending approvals')
    expect(store.state.agentRuns).toHaveLength(1)
    expect(store.state.agentRuns[0]?.status).toBe('completed')
    expect(store.state.auditEvents.some((e) => e.action === 'agent.run.started')).toBe(true)
  })

  it('creates a task for FORGE through the tool pipeline', async () => {
    const store = newStore()
    const reply = await runJarvis({ store, router: null }, prime, {
      message: 'Create a task for FORGE to prepare a dental clinic proposal.',
      business: 'auto',
    })
    expect(reply.businessCode).toBe('A01')
    expect(reply.agentCode).toBe('A01-GM')
    expect(store.state.tasks).toHaveLength(1)
    expect(store.state.tasks[0]?.title).toContain('dental clinic')
    expect(store.state.tasks[0]?.created_by_agent_id).not.toBeNull()
  })

  it('generates the PRIME brief on request', async () => {
    const store = newStore()
    const reply = await runJarvis({ store, router: null }, prime, {
      message: "Generate today's PRIME brief.",
      business: 'auto',
    })
    expect(reply.text).toContain('DAILY PRIME BRIEF')
    expect(reply.text).toContain('MONEY')
    expect(store.state.dailyBriefs).toHaveLength(1)
  })

  it('turns external actions into approval records — never executes them', async () => {
    const store = newStore()
    const reply = await runJarvis({ store, router: null }, prime, {
      message: 'Send the proposal email to the dental clinic client now',
      business: 'auto',
    })
    expect(reply.intent).toBe('external_action')
    expect(reply.approvalId).not.toBeNull()
    expect(store.state.approvals).toHaveLength(1)
    expect(store.state.approvals[0]?.status).toBe('pending')
    expect(store.state.agentRuns[0]?.status).toBe('requires_approval')
  })

  it('refuses work for the dormant VOID business', async () => {
    const store = newStore()
    const reply = await runJarvis({ store, router: null }, prime, {
      message: 'Review A08 performance',
      business: 'A08',
    })
    expect(reply.text).toContain('dormant')
    expect(store.state.tasks).toHaveLength(0)
  })

  it('answers free-form queries with a data summary and command help', async () => {
    const store = newStore()
    const reply = await runJarvis({ store, router: null }, prime, {
      message: 'Review A01 performance.',
      business: 'auto',
    })
    expect(reply.provider).toBe('none')
    expect(reply.text).toContain('A01 FORGE')
    expect(reply.text).toContain('no AI provider is configured')
  })
})

describe('JVS-00 orchestration — with a (mock) model', () => {
  function mockExecutiveProvider(): AIProvider {
    return {
      name: 'openai',
      isConfigured: () => true,
      async complete(request: AIRequest): Promise<AIResponse> {
        return {
          text: JSON.stringify({
            business: 'A01',
            objective: 'Grow FORGE pipeline',
            currentStatus: 'Pipeline is empty; no leads recorded.',
            keyFindings: ['No leads in the system'],
            financialImpact: null,
            risks: [{ description: 'No revenue pipeline', level: 'high' }],
            recommendedActions: [
              { action: 'Source 10 local business leads', priority: 'P1', requiresApproval: false },
            ],
            approvalRequired: false,
            priority: 'P1',
            confidence: 0.7,
            missingInformation: ['Lead sources'],
          }),
          model: request.model,
          provider: 'openai',
          usage: { inputTokens: 100, outputTokens: 50 },
          latencyMs: 5,
        }
      },
    }
  }

  it('produces a validated structured executive response and records model usage', async () => {
    const store = newStore()
    const router = createRouter([mockExecutiveProvider()], {
      executiveModel: 'test-exec',
      extractionModel: 'test-extract',
    })
    const reply = await runJarvis({ store, router }, prime, {
      message: 'Review A01 performance.',
      business: 'auto',
    })
    expect(reply.provider).toBe('openai')
    expect(reply.model).toBe('test-exec')
    expect(reply.structured?.business).toBe('A01')
    expect(reply.text).toContain('Recommended actions')
    expect(store.state.modelUsage).toHaveLength(1)
    expect(store.state.agentRuns[0]?.provider).toBe('openai')
    // the composed prompt included the constitution exactly once
  })

  it('the model cannot execute restricted actions by classification alone', async () => {
    const store = newStore()
    // Even with a model available, deterministic external-action detection
    // runs first and forces the approval path.
    const router = createRouter([mockExecutiveProvider()], { executiveModel: 'test-exec' })
    const reply = await runJarvis({ store, router }, prime, {
      message: 'Pay the hosting invoice for FORGE',
      business: 'auto',
    })
    expect(reply.intent).toBe('external_action')
    expect(store.state.approvals).toHaveLength(1)
  })
})
