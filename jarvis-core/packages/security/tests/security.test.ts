import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildAuditEvent } from '../src/audit'
import { createInMemoryRateLimiter } from '../src/rate-limit'
import { redactSecrets } from '../src/redact'
import { PublicError, toSafeError } from '../src/safe-error'
import { createHmacSha256Verifier } from '../src/webhooks'

describe('secret redaction', () => {
  it('redacts sensitive keys at any depth', () => {
    const result = redactSecrets({
      user: 'prime',
      api_key: 'sk-abc123',
      nested: { authorization: 'Bearer xyz', config: { webhookSecret: 'whsec_1' } },
    }) as Record<string, unknown>
    expect(result.api_key).toBe('[REDACTED]')
    expect((result.nested as Record<string, unknown>).authorization).toBe('[REDACTED]')
    expect(
      ((result.nested as Record<string, Record<string, unknown>>).config as Record<string, unknown>)
        .webhookSecret
    ).toBe('[REDACTED]')
    expect(result.user).toBe('prime')
  })

  it('redacts secret-shaped values under innocent keys', () => {
    const result = redactSecrets({ note: 'sk-live-abcdef123456' }) as Record<string, unknown>
    expect(result.note).toBe('[REDACTED]')
  })
})

describe('audit event builder', () => {
  it('builds a persistable event and redacts payloads', () => {
    const event = buildAuditEvent({
      organizationId: 'org-1',
      actorType: 'agent',
      actorId: 'agent-1',
      action: 'tool.executed',
      resourceType: 'task',
      afterData: { title: 'ok', api_key: 'sk-nope' },
    })
    expect(event.action).toBe('tool.executed')
    expect((event.after_data as Record<string, unknown>).api_key).toBe('[REDACTED]')
    expect(event.organization_id).toBe('org-1')
  })

  it('rejects invalid action names', () => {
    expect(() => buildAuditEvent({ actorType: 'system', action: 'x' })).toThrow()
  })
})

describe('rate limiter', () => {
  it('allows up to the limit then blocks within the window', async () => {
    const limiter = createInMemoryRateLimiter({ windowMs: 60_000, maxRequests: 3 })
    expect(await limiter.check('k')).toBe(true)
    expect(await limiter.check('k')).toBe(true)
    expect(await limiter.check('k')).toBe(true)
    expect(await limiter.check('k')).toBe(false)
    expect(await limiter.check('other')).toBe(true)
  })
})

describe('safe errors', () => {
  it('hides internal error details', () => {
    const safe = toSafeError(new Error('connection to db 10.0.0.5 failed'), 'db_error', 'req-1')
    expect(safe.message).not.toContain('10.0.0.5')
    expect(safe.code).toBe('db_error')
  })

  it('lets intentional public errors through', () => {
    const safe = toSafeError(new PublicError('Business A08 is dormant', 'dormant'))
    expect(safe.message).toBe('Business A08 is dormant')
    expect(safe.code).toBe('dormant')
  })
})

describe('webhook verification', () => {
  it('verifies a valid HMAC signature and rejects a tampered payload', () => {
    const verifier = createHmacSha256Verifier('a-sufficiently-long-secret')
    const payload = '{"event":"test"}'
    const sig = createHmac('sha256', 'a-sufficiently-long-secret').update(payload).digest('hex')
    expect(verifier.verify(payload, sig)).toBe(true)
    expect(verifier.verify(payload + ' ', sig)).toBe(false)
    expect(verifier.verify(payload, 'deadbeef')).toBe(false)
  })

  it('refuses weak secrets', () => {
    expect(() => createHmacSha256Verifier('short')).toThrow()
  })
})
