import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { constantTimeCompareSecrets, sha256Hex } from '../src/constant-time'

describe('constantTimeCompareSecrets', () => {
  it('accepts identical secrets', () => {
    expect(
      constantTimeCompareSecrets('a-long-shared-secret-value', 'a-long-shared-secret-value')
    ).toBe(true)
  })

  it('rejects different secrets of equal length', () => {
    expect(constantTimeCompareSecrets('aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaab')).toBe(false)
  })

  it('rejects differing lengths without throwing (hashing removes the length oracle)', () => {
    expect(constantTimeCompareSecrets('short', 'a-much-longer-secret-value')).toBe(false)
    expect(constantTimeCompareSecrets('a-much-longer-secret-value', 'short')).toBe(false)
  })

  it('fails closed on empty input', () => {
    expect(constantTimeCompareSecrets('', 'secret')).toBe(false)
    expect(constantTimeCompareSecrets('secret', '')).toBe(false)
    expect(constantTimeCompareSecrets('', '')).toBe(false)
  })
})

describe('sha256Hex', () => {
  it('produces a 64-char lowercase hex digest matching node crypto', () => {
    const value = 'nonce-material'
    const expected = createHash('sha256').update(value, 'utf8').digest('hex')
    expect(sha256Hex(value)).toBe(expected)
    expect(sha256Hex(value)).toMatch(/^[0-9a-f]{64}$/)
  })
})
