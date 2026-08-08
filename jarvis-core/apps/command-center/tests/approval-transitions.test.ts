import { describe, expect, it } from 'vitest'
import {
  approvalTransitionAllowed,
  isRequestOrigin,
  isTerminalApprovalStatus,
  REQUEST_ORIGINS,
  TRANSITION_ACTOR_KINDS,
} from '@jarvis/shared'
import {
  describeRpcError,
  GENERIC_TRANSITION_ERROR,
  isPrimeResolution,
  isStaleViewError,
  parseRpcErrorReason,
  PRIME_RESOLUTIONS,
  RPC_ERROR_REASONS,
} from '../lib/approval-transitions'

// The SQL function is authoritative for the transition rules; these
// tests pin the TypeScript mirror's shape and the error mapping. Parity
// between the two matrices is proven separately, against a live
// database, by supabase/tests/transition_parity.sh.

describe('approval transition matrix (mirror of approval_transition_allowed)', () => {
  it('lets PRIME resolve a pending request four ways', () => {
    for (const to of ['approved', 'rejected', 'modified', 'cancelled'] as const) {
      expect(approvalTransitionAllowed('pending', to, 'prime')).toBe(true)
    }
  })

  it('lets PRIME cancel a resolved but unexecuted request', () => {
    expect(approvalTransitionAllowed('approved', 'cancelled', 'prime')).toBe(true)
    expect(approvalTransitionAllowed('modified', 'cancelled', 'prime')).toBe(true)
  })

  it('never lets PRIME reach an executor-only outcome', () => {
    for (const from of ['pending', 'approved', 'modified'] as const) {
      expect(approvalTransitionAllowed(from, 'executed', 'prime')).toBe(false)
      expect(approvalTransitionAllowed(from, 'failed', 'prime')).toBe(false)
    }
  })

  it('lets only an executor record an outcome, and only from approved or modified', () => {
    expect(approvalTransitionAllowed('approved', 'executed', 'executor')).toBe(true)
    expect(approvalTransitionAllowed('modified', 'failed', 'executor')).toBe(true)
    expect(approvalTransitionAllowed('pending', 'executed', 'executor')).toBe(false)
    expect(approvalTransitionAllowed('approved', 'executed', 'system')).toBe(false)
    expect(approvalTransitionAllowed('approved', 'executed', 'prime')).toBe(false)
  })

  it('lets only the system expire, and only what is still actionable', () => {
    for (const from of ['pending', 'approved', 'modified'] as const) {
      expect(approvalTransitionAllowed(from, 'expired', 'system')).toBe(true)
      expect(approvalTransitionAllowed(from, 'expired', 'prime')).toBe(false)
    }
    expect(approvalTransitionAllowed('rejected', 'expired', 'system')).toBe(false)
  })

  it('treats every terminal status as final for every actor kind', () => {
    const terminal = ['rejected', 'executed', 'failed', 'expired', 'cancelled'] as const
    for (const from of terminal) {
      expect(isTerminalApprovalStatus(from)).toBe(true)
      for (const kind of TRANSITION_ACTOR_KINDS) {
        for (const to of ['pending', 'approved', 'rejected', 'executed'] as const) {
          expect(approvalTransitionAllowed(from, to, kind)).toBe(false)
        }
      }
    }
  })

  it('fails closed for an unknown actor kind', () => {
    for (const kind of ['agent', 'root', 'PRIME', '', 'prime ']) {
      expect(approvalTransitionAllowed('pending', 'approved', kind)).toBe(false)
    }
  })

  it('never permits a status to transition to itself', () => {
    for (const s of ['pending', 'approved', 'modified'] as const) {
      for (const kind of TRANSITION_ACTOR_KINDS) {
        expect(approvalTransitionAllowed(s, s, kind)).toBe(false)
      }
    }
  })
})

describe('request origin enumeration', () => {
  it('accepts exactly the six documented origins', () => {
    expect([...REQUEST_ORIGINS]).toEqual(['web', 'agent', 'cron', 'api', 'executor', 'migration'])
    for (const origin of REQUEST_ORIGINS) expect(isRequestOrigin(origin)).toBe(true)
  })

  it('rejects anything else, including near-misses and non-strings', () => {
    for (const bad of ['browser', 'Web', 'WEB', '', ' web', null, undefined, 7, {}]) {
      expect(isRequestOrigin(bad)).toBe(false)
    }
  })
})

describe('PRIME resolutions', () => {
  it('are the four PRIME can apply from a pending approval', () => {
    expect([...PRIME_RESOLUTIONS]).toEqual(['approved', 'rejected', 'modified', 'cancelled'])
    for (const r of PRIME_RESOLUTIONS) {
      expect(isPrimeResolution(r)).toBe(true)
      expect(approvalTransitionAllowed('pending', r, 'prime')).toBe(true)
    }
  })

  it('exclude the outcomes only an executor or the system may set', () => {
    for (const r of ['executed', 'failed', 'expired', 'pending']) {
      expect(isPrimeResolution(r)).toBe(false)
    }
  })
})

describe('RPC error mapping', () => {
  it('recognises every documented reason and gives each a distinct message', () => {
    const messages = new Set<string>()
    for (const reason of RPC_ERROR_REASONS) {
      const message = describeRpcError(reason)
      expect(message).not.toBe(GENERIC_TRANSITION_ERROR)
      messages.add(message)
    }
    expect(messages.size).toBe(RPC_ERROR_REASONS.length)
  })

  it('extracts the reason from a wrapped transport error', () => {
    expect(
      parseRpcErrorReason(
        'Postgres error: not_prime (SQLSTATE P0001) while calling resolve_approval'
      )
    ).toBe('not_prime')
    expect(parseRpcErrorReason('stale_status')).toBe('stale_status')
  })

  it('does not match a reason embedded inside a longer identifier', () => {
    expect(parseRpcErrorReason('xnot_primex')).toBeNull()
    expect(parseRpcErrorReason('not_primed')).toBeNull()
    expect(parseRpcErrorReason('super_stale_status_thing')).toBeNull()
  })

  it('collapses anything unrecognised to a generic message', () => {
    for (const message of [
      null,
      undefined,
      '',
      'connection to server at "db.internal" port 5432 failed',
      'permission denied for table audit_logs',
      'duplicate key value violates unique constraint "audit_logs_idempotency_idx"',
    ]) {
      expect(describeRpcError(message)).toBe(GENERIC_TRANSITION_ERROR)
    }
  })

  it('never leaks a hostname, table name or SQLSTATE through the generic message', () => {
    const leaked = describeRpcError('relation "public.memberships" does not exist at db.internal')
    expect(leaked).toBe(GENERIC_TRANSITION_ERROR)
    expect(GENERIC_TRANSITION_ERROR).not.toMatch(/public\.|SQLSTATE|P0001|5432/)
  })

  it('flags exactly the failures that mean the caller should reload', () => {
    expect(isStaleViewError('stale_status')).toBe(true)
    expect(isStaleViewError('invalid_transition')).toBe(true)
    expect(isStaleViewError('not_prime')).toBe(false)
    expect(isStaleViewError('something else entirely')).toBe(false)
  })
})
