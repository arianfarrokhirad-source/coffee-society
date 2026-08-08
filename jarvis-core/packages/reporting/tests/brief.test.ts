import { describe, expect, it } from 'vitest'
import { createInMemoryStore } from '@jarvis/database'
import { composeBrief, generateDailyBrief } from '../src/brief'

describe('daily brief composition', () => {
  it('produces all six sections and reports only meaningful activity', async () => {
    const store = createInMemoryStore()
    const orgId = store.state.organizationId
    const forge = await store.getBusinessByCode('A01')

    await store.createTask({
      organizationId: orgId,
      businessId: forge!.id,
      title: 'Overdue audit',
      priority: 'P1',
      dueDate: '2020-01-01',
    })
    await store.createApproval({
      organizationId: orgId,
      businessId: forge!.id,
      requestedByUserId: 'u1',
      actionType: 'external.execute',
      actionPayload: {},
      reason: 'Send proposal',
      estimatedCost: 250,
      currency: 'EUR',
      riskLevel: 'high',
      requestId: 'brief-test-approval-1',
      origin: 'web',
    })

    const data = await store.getBriefData(orgId, '2026-08-01T00:00:00.000Z')
    const brief = composeBrief('2026-08-01', data)

    expect(brief.briefDate).toBe('2026-08-01')
    expect(brief.money.some((m) => m.includes('250'))).toBe(true)
    expect(brief.threats.some((t) => t.includes('Overdue audit'))).toBe(true)
    expect(brief.approvals).toHaveLength(1)
    expect(brief.todaysPriority.length).toBeGreaterThan(0)
    // every active business has no objectives → flagged as missing data
    expect(brief.systemHealth.some((s) => s.includes('no objectives'))).toBe(true)
  })

  it('consolidates all businesses into ONE brief and persists idempotently', async () => {
    const store = createInMemoryStore()
    const orgId = store.state.organizationId
    const first = await generateDailyBrief(store, {
      organizationId: orgId,
      briefDate: '2026-08-01',
    })
    const second = await generateDailyBrief(store, {
      organizationId: orgId,
      briefDate: '2026-08-01',
    })
    expect(store.state.dailyBriefs).toHaveLength(1)
    expect(first.brief.id).toBe(second.brief.id)
    // system event deduped by briefDate
    expect(
      store.state.systemEvents.filter((e) => e.eventType === 'daily_brief.requested')
    ).toHaveLength(1)
    // P2 notification stored in-app
    expect(store.state.notifications.some((n) => n.priority === 'P2')).toBe(true)
  })

  it('empty state produces empty sections, not fabricated content', async () => {
    const store = createInMemoryStore()
    const data = await store.getBriefData(store.state.organizationId, '2026-08-01T00:00:00.000Z')
    const brief = composeBrief('2026-08-01', data)
    expect(brief.money).toHaveLength(0)
    expect(brief.approvals).toHaveLength(0)
    expect(brief.opportunities).toHaveLength(0)
  })
})
