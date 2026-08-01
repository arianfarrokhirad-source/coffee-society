import { describe, expect, it } from 'vitest'
import { isCronAuthorized } from '../lib/cron-auth'

const SECRET = 'a-very-long-cron-secret-value'

describe('cron endpoint authorization', () => {
  it('accepts the correct bearer token', () => {
    expect(isCronAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true)
  })

  it('rejects a wrong token', () => {
    expect(isCronAuthorized('Bearer wrong-token-wrong-token-wrong', SECRET)).toBe(false)
  })

  it('rejects a missing header', () => {
    expect(isCronAuthorized(null, SECRET)).toBe(false)
  })

  it('refuses to operate with a missing or weak secret', () => {
    expect(isCronAuthorized(`Bearer ${SECRET}`, undefined)).toBe(false)
    expect(isCronAuthorized('Bearer short', 'short')).toBe(false)
  })
})
