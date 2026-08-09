import { describe, expect, it } from 'vitest'
import {
  claimWindowStart,
  CLAIM_ATTEMPT_LIMIT,
  GENERIC_CLAIM_ERROR,
  isClaimEnabled,
  isRateLimited,
  mapRpcErrorToReason,
  MIN_SETUP_TOKEN_LENGTH,
  validateSetupToken,
} from '../lib/prime-claim'

const VALID_TOKEN = 'x'.repeat(MIN_SETUP_TOKEN_LENGTH)

describe('claim configuration (fail closed)', () => {
  it('is disabled when no token is configured', () => {
    expect(isClaimEnabled({ token: undefined })).toBe(false)
    expect(validateSetupToken(VALID_TOKEN, { token: undefined })).toEqual({
      ok: false,
      reason: 'configuration_disabled',
    })
  })

  it('is disabled when the configured token is too short', () => {
    const short = 'x'.repeat(MIN_SETUP_TOKEN_LENGTH - 1)
    expect(isClaimEnabled({ token: short })).toBe(false)
    expect(validateSetupToken(short, { token: short })).toEqual({
      ok: false,
      reason: 'configuration_disabled',
    })
  })

  it('is enabled with a sufficiently long token', () => {
    expect(isClaimEnabled({ token: VALID_TOKEN })).toBe(true)
  })
})

describe('setup token validation', () => {
  it('accepts the exact configured token', () => {
    expect(validateSetupToken(VALID_TOKEN, { token: VALID_TOKEN })).toEqual({ ok: true })
  })

  it('rejects a wrong token of the same length', () => {
    const wrong = 'y'.repeat(MIN_SETUP_TOKEN_LENGTH)
    expect(validateSetupToken(wrong, { token: VALID_TOKEN })).toEqual({
      ok: false,
      reason: 'invalid_token',
    })
  })

  it('rejects a missing/empty submitted token', () => {
    expect(validateSetupToken('', { token: VALID_TOKEN })).toEqual({
      ok: false,
      reason: 'invalid_token',
    })
  })

  it('rejects tokens of differing length without throwing (no length oracle)', () => {
    expect(validateSetupToken(VALID_TOKEN + 'extra', { token: VALID_TOKEN }).ok).toBe(false)
    expect(validateSetupToken('short', { token: VALID_TOKEN }).ok).toBe(false)
  })

  it('rejects a prefix of the configured token', () => {
    expect(validateSetupToken(VALID_TOKEN.slice(0, -1), { token: VALID_TOKEN }).ok).toBe(false)
  })
})

describe('bootstrap rate limiting', () => {
  it('allows attempts below the limit', () => {
    expect(isRateLimited(0)).toBe(false)
    expect(isRateLimited(CLAIM_ATTEMPT_LIMIT - 1)).toBe(false)
  })

  it('blocks at and above the limit', () => {
    expect(isRateLimited(CLAIM_ATTEMPT_LIMIT)).toBe(true)
    expect(isRateLimited(CLAIM_ATTEMPT_LIMIT + 10)).toBe(true)
  })

  it('fails closed on malformed counts', () => {
    expect(isRateLimited(null)).toBe(true)
    expect(isRateLimited(undefined)).toBe(true)
    expect(isRateLimited(Number.NaN)).toBe(true)
  })

  it('computes a window start in the past', () => {
    const now = new Date('2026-08-01T12:00:00.000Z')
    expect(claimWindowStart(now)).toBe('2026-08-01T11:45:00.000Z')
  })
})

describe('rpc error mapping', () => {
  it('maps known database reason codes', () => {
    expect(mapRpcErrorToReason('claim_already_completed')).toBe('claim_already_completed')
    expect(mapRpcErrorToReason('consumed_nonce')).toBe('consumed_nonce')
    expect(mapRpcErrorToReason('expired_nonce')).toBe('expired_nonce')
    expect(mapRpcErrorToReason('nonce_user_mismatch')).toBe('nonce_user_mismatch')
    expect(mapRpcErrorToReason('invalid_nonce')).toBe('invalid_nonce')
  })

  it('falls back to rpc_failure for unknown errors', () => {
    expect(mapRpcErrorToReason('connection refused at 10.0.0.5')).toBe('rpc_failure')
  })
})

describe('user-facing error surface', () => {
  // The message is deliberately identical for every failure path, so it
  // cannot act as an oracle distinguishing wrong-token from rate-limited
  // from already-claimed. It may still carry generic guidance.
  it('contains no internal reason code', () => {
    const reasonCodes = [
      'unauthenticated',
      'claim_already_completed',
      'rate_limited',
      'configuration_disabled',
      'invalid_token',
      'invalid_nonce',
      'expired_nonce',
      'consumed_nonce',
      'nonce_user_mismatch',
      'rpc_failure',
      'audit_failure',
    ]
    for (const code of reasonCodes) {
      expect(GENERIC_CLAIM_ERROR).not.toContain(code)
    }
  })

  it('never reveals which failure occurred (no nonce/secret material)', () => {
    expect(GENERIC_CLAIM_ERROR).not.toMatch(/nonce|hash|sha256|env|JARVIS_PRIME_SETUP_TOKEN/i)
  })
})
