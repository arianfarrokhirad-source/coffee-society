import { createHmac, timingSafeEqual } from 'node:crypto'

// Webhook signature verification interface (placeholder wiring for
// future integrations). HMAC-SHA256 verification is standard practice —
// no custom cryptography.

export interface WebhookVerifier {
  verify(payload: string, signatureHeader: string): boolean
}

export function createHmacSha256Verifier(secret: string): WebhookVerifier {
  if (!secret || secret.length < 16) {
    throw new Error('webhook secret must be at least 16 characters')
  }
  return {
    verify(payload: string, signatureHeader: string): boolean {
      const expected = createHmac('sha256', secret).update(payload, 'utf8').digest('hex')
      const provided = signatureHeader.replace(/^sha256=/, '')
      if (provided.length !== expected.length) return false
      return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(provided, 'utf8'))
    },
  }
}
