import type { AuthorityLevel } from '@jarvis/shared'
import { AUTHORITY_LEVELS } from '@jarvis/shared'

export function authorityRank(level: AuthorityLevel): number {
  return AUTHORITY_LEVELS.indexOf(level)
}

/** true when `actual` meets or exceeds `required`. */
export function meetsAuthority(actual: AuthorityLevel, required: AuthorityLevel): boolean {
  return authorityRank(actual) >= authorityRank(required)
}

export function compareAuthority(a: AuthorityLevel, b: AuthorityLevel): -1 | 0 | 1 {
  const d = authorityRank(a) - authorityRank(b)
  return d < 0 ? -1 : d > 0 ? 1 : 0
}

export function isValidAuthority(value: string): value is AuthorityLevel {
  return (AUTHORITY_LEVELS as readonly string[]).includes(value)
}
