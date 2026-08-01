import { describe, expect, it } from 'vitest'
import { authorityRank, compareAuthority, isValidAuthority, meetsAuthority } from '../src/authority'

describe('authority comparison', () => {
  it('ranks L0 through L5 in order', () => {
    expect(authorityRank('L0')).toBe(0)
    expect(authorityRank('L5')).toBe(5)
  })

  it('meetsAuthority is inclusive of the exact level', () => {
    expect(meetsAuthority('L2', 'L2')).toBe(true)
    expect(meetsAuthority('L3', 'L2')).toBe(true)
    expect(meetsAuthority('L1', 'L2')).toBe(false)
  })

  it('L5 meets everything, L0 meets only L0', () => {
    for (const level of ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'] as const) {
      expect(meetsAuthority('L5', level)).toBe(true)
    }
    expect(meetsAuthority('L0', 'L0')).toBe(true)
    expect(meetsAuthority('L0', 'L1')).toBe(false)
  })

  it('compareAuthority returns a total order', () => {
    expect(compareAuthority('L1', 'L4')).toBe(-1)
    expect(compareAuthority('L4', 'L1')).toBe(1)
    expect(compareAuthority('L3', 'L3')).toBe(0)
  })

  it('validates authority strings', () => {
    expect(isValidAuthority('L3')).toBe(true)
    expect(isValidAuthority('L6')).toBe(false)
    expect(isValidAuthority('admin')).toBe(false)
  })
})
