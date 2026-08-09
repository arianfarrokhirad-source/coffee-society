import { timingSafeEqual } from 'node:crypto'

/**
 * Constant-time bearer-token check for scheduled endpoints. Refuses to
 * operate at all when the configured secret is missing or too short.
 */
export function isCronAuthorized(
  authorizationHeader: string | null,
  secret: string | undefined
): boolean {
  if (!secret || secret.length < 16) return false
  const provided = (authorizationHeader ?? '').replace(/^Bearer\s+/i, '')
  if (provided.length !== secret.length) return false
  return timingSafeEqual(Buffer.from(provided), Buffer.from(secret))
}
