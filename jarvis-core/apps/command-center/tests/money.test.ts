import { describe, expect, it } from 'vitest'
import { money, sumByCurrency } from '@/lib/money'

// Shared by proposals and maintenance. The one rule worth pinning is
// that currencies are never added together — a mixed total is a wrong
// number presented with the same confidence as a right one.

describe('money', () => {
  it('formats a number and a numeric string identically', () => {
    // PostgREST returns `numeric` as a string to avoid JSON precision
    // loss, so both shapes arrive in practice.
    expect(money(400, 'EUR')).toBe(money('400', 'EUR'))
  })

  it('renders an em dash for a missing amount', () => {
    expect(money(null, 'EUR')).toBe('—')
    expect(money('not a number', 'EUR')).toBe('—')
  })

  it('falls back rather than blanking the page on a bad currency code', () => {
    expect(money(400, 'NOT-A-CODE')).toBe('400.00 NOT-A-CODE')
  })

  it('formats zero as an amount, not as absent', () => {
    // A zero-amount plan is a real arrangement; showing '—' would hide it.
    expect(money(0, 'EUR')).not.toBe('—')
  })
})

describe('sumByCurrency', () => {
  it('groups totals per currency and never across them', () => {
    const totals = sumByCurrency([
      { amount: 400, currency: 'EUR' },
      { amount: '100', currency: 'EUR' },
      { amount: 250, currency: 'GBP' },
    ])
    expect(totals).toEqual([
      { currency: 'EUR', total: 500 },
      { currency: 'GBP', total: 250 },
    ])
  })

  it('skips unparseable amounts instead of poisoning the total with NaN', () => {
    const totals = sumByCurrency([
      { amount: 100, currency: 'EUR' },
      { amount: 'oops', currency: 'EUR' },
    ])
    expect(totals).toEqual([{ currency: 'EUR', total: 100 }])
  })

  it('treats a null amount as zero', () => {
    expect(sumByCurrency([{ amount: null, currency: 'EUR' }])).toEqual([
      { currency: 'EUR', total: 0 },
    ])
  })

  it('returns nothing for no rows', () => {
    expect(sumByCurrency([])).toEqual([])
  })
})
