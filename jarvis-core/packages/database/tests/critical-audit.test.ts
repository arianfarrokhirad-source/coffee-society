import { describe, expect, it } from 'vitest'
import { buildAuditEvent, CRITICAL_AUDIT_ACTIONS, isCriticalAuditAction } from '@jarvis/security'
import { createInMemoryStore } from '../src/store-memory'

// These pin the application-side half of the fail-closed auditing
// boundary. The database half is verified against a real PostgreSQL
// instance by supabase/tests/critical_audit_verification.sql.

describe('critical vs telemetry audit actions', () => {
  it('refuses to build a critical audit event through the telemetry path', () => {
    for (const action of CRITICAL_AUDIT_ACTIONS) {
      expect(isCriticalAuditAction(action)).toBe(true)
      expect(() => buildAuditEvent({ actorType: 'user', action })).toThrow(/database RPC/)
    }
  })

  it('still builds ordinary telemetry events', () => {
    for (const action of [
      'tool.executed',
      'agent.run.started',
      'brief.generated',
      'auth.sign_in',
    ]) {
      expect(isCriticalAuditAction(action)).toBe(false)
      expect(buildAuditEvent({ actorType: 'system', action }).action).toBe(action)
    }
  })

  it('covers every action the auditing RPCs write', () => {
    // A new critical RPC that forgets this list would be able to write
    // its audit row through the non-atomic path.
    expect([...CRITICAL_AUDIT_ACTIONS].sort()).toEqual(
      [
        'agent.actions_changed',
        'agent.activated',
        'agent.authority_changed',
        'agent.deactivated',
        'agent.financial_authority_changed',
        'membership.created',
        'membership.revoked',
        'membership.role_changed',
        'approval.approved',
        'approval.cancelled',
        'approval.created',
        'approval.executed',
        'approval.expired',
        'approval.failed',
        'approval.modified',
        'approval.rejected',
      ].sort()
    )
  })
})

describe('store.createApproval (mirror of create_approval_audited)', () => {
  const base = (store: ReturnType<typeof createInMemoryStore>) => ({
    organizationId: store.state.organizationId,
    businessId: null,
    requestedByUserId: 'user-1',
    actionType: 'payment.send',
    actionPayload: { amount: 100, to: 'acct-1' },
    riskLevel: 'high' as const,
    origin: 'web' as const,
  })

  it('writes the approval, its audit row and its event together', async () => {
    const store = createInMemoryStore()
    const approval = await store.createApproval({ ...base(store), requestId: 'r1' })

    const audit = store.state.auditEvents.find((e) => e.action === 'approval.created')
    expect(audit?.resource_id).toBe(approval.id)
    expect(audit?.request_id).toBe('r1')
    expect((audit?.metadata as Record<string, unknown>).request_origin).toBe('web')
    expect(
      store.state.systemEvents.some(
        (e) => e.eventType === 'approval.requested' && e.payload?.approvalId === approval.id
      )
    ).toBe(true)
  })

  it('hashes the payload instead of copying it into the audit row', async () => {
    const store = createInMemoryStore()
    await store.createApproval({ ...base(store), requestId: 'r1' })
    const audit = store.state.auditEvents.find((e) => e.action === 'approval.created')
    expect((audit?.after_data as Record<string, unknown>).payload_sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(audit)).not.toContain('acct-1')
  })

  it('collapses a replay of the same request id to one approval', async () => {
    const store = createInMemoryStore()
    const first = await store.createApproval({ ...base(store), requestId: 'r1' })
    const second = await store.createApproval({ ...base(store), requestId: 'r1' })
    expect(second.id).toBe(first.id)
    expect(store.state.approvals).toHaveLength(1)
    expect(store.state.auditEvents.filter((e) => e.action === 'approval.created')).toHaveLength(1)
  })

  it('fails closed on a missing request id, bad origin or absent requester', async () => {
    const store = createInMemoryStore()
    await expect(store.createApproval({ ...base(store), requestId: '' })).rejects.toThrow(
      'request_id_required'
    )
    await expect(
      store.createApproval({
        ...base(store),
        requestId: 'r1',
        origin: 'browser' as unknown as 'web',
      })
    ).rejects.toThrow('invalid_request_origin')
    await expect(
      store.createApproval({ ...base(store), requestId: 'r1', requestedByUserId: null })
    ).rejects.toThrow('requester_required')
    expect(store.state.approvals).toHaveLength(0)
    expect(store.state.auditEvents).toHaveLength(0)
  })
})

describe('store.resolveApproval (mirror of resolve_approval)', () => {
  const seed = async () => {
    const store = createInMemoryStore()
    const approval = await store.createApproval({
      organizationId: store.state.organizationId,
      requestedByUserId: 'user-1',
      actionType: 'payment.send',
      actionPayload: {},
      riskLevel: 'high',
      requestId: 'setup',
      origin: 'web',
    })
    return { store, approval }
  }

  it('applies the transition with its audit row and event', async () => {
    const { store, approval } = await seed()
    await store.resolveApproval({
      actorId: 'prime-1',
      approvalId: approval.id,
      expectedStatus: 'pending',
      resolution: 'approved',
      requestId: 'r-ok',
      origin: 'web',
    })
    expect(store.state.approvals[0]?.status).toBe('approved')
    expect(store.state.approvals[0]?.approved_by).toBe('prime-1')

    const audit = store.state.auditEvents.find((e) => e.action === 'approval.approved')
    expect((audit?.before_data as Record<string, unknown>).status).toBe('pending')
    expect((audit?.after_data as Record<string, unknown>).status).toBe('approved')
    expect((audit?.metadata as Record<string, unknown>).transition).toBe('pending->approved')
  })

  it('refuses a stale expected status without changing anything', async () => {
    const { store, approval } = await seed()
    await expect(
      store.resolveApproval({
        actorId: 'prime-1',
        approvalId: approval.id,
        expectedStatus: 'approved',
        resolution: 'cancelled',
        requestId: 'r-stale',
        origin: 'web',
      })
    ).rejects.toThrow('stale_status')
    expect(store.state.approvals[0]?.status).toBe('pending')
    expect(store.state.auditEvents.filter((e) => e.action.startsWith('approval.'))).toHaveLength(1)
  })

  it('refuses a transition PRIME may not make', async () => {
    const { store, approval } = await seed()
    await expect(
      store.resolveApproval({
        actorId: 'prime-1',
        approvalId: approval.id,
        expectedStatus: 'pending',
        resolution: 'executed',
        requestId: 'r-exec',
        origin: 'web',
      })
    ).rejects.toThrow('invalid_transition')
    expect(store.state.approvals[0]?.status).toBe('pending')
  })

  it('treats a replay of the same request id as a no-op', async () => {
    const { store, approval } = await seed()
    const args = {
      actorId: 'prime-1',
      approvalId: approval.id,
      expectedStatus: 'pending' as const,
      resolution: 'approved' as const,
      requestId: 'r-ok',
      origin: 'web' as const,
    }
    await store.resolveApproval(args)
    await store.resolveApproval(args)
    expect(store.state.auditEvents.filter((e) => e.action === 'approval.approved')).toHaveLength(1)
  })

  it('rejects an unknown approval and an invalid origin', async () => {
    const { store, approval } = await seed()
    await expect(
      store.resolveApproval({
        actorId: 'prime-1',
        approvalId: '00000000-0000-0000-0000-000000000000',
        expectedStatus: 'pending',
        resolution: 'approved',
        requestId: 'r-missing',
        origin: 'web',
      })
    ).rejects.toThrow('approval_not_found')
    await expect(
      store.resolveApproval({
        actorId: 'prime-1',
        approvalId: approval.id,
        expectedStatus: 'pending',
        resolution: 'approved',
        requestId: 'r-origin',
        origin: 'satellite' as unknown as 'web',
      })
    ).rejects.toThrow('invalid_request_origin')
    expect(store.state.approvals[0]?.status).toBe('pending')
  })
})
