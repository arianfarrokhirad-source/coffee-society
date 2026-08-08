import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Constant-time secret comparison.
 *
 * Both sides are SHA-256 hashed first so the comparison operates on
 * fixed-length buffers: this removes the length oracle that a direct
 * timingSafeEqual would expose (it throws on length mismatch) without
 * leaking anything about the expected secret's length.
 *
 * Returns false for empty/absent input rather than throwing — callers
 * are security paths that must fail closed, not crash.
 */
export function constantTimeCompareSecrets(provided: string, expected: string): boolean {
  if (!provided || !expected) return false
  const a = createHash('sha256').update(provided, 'utf8').digest()
  const b = createHash('sha256').update(expected, 'utf8').digest()
  return timingSafeEqual(a, b)
}

/** SHA-256 hex digest. Used to store nonce hashes (never raw values). */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
