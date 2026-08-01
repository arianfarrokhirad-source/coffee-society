// Secret redaction for anything persisted to logs/audit. Applied before
// writing before/after payloads, tool arguments or error details.

const SENSITIVE_KEY = /(key|secret|token|password|credential|authorization|cookie|signature)/i
const SENSITIVE_VALUE = /^(sk-|sk_live|whsec_|eyJ[A-Za-z0-9_-]{10,})/

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue }

export function redactSecrets(value: JsonValue, depth = 0): JsonValue {
  if (depth > 8) return '[REDACTED:depth]'
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') {
    return SENSITIVE_VALUE.test(value) ? '[REDACTED]' : value
  }
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1))
  const out: { [k: string]: JsonValue } = {}
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : redactSecrets(v, depth + 1)
  }
  return out
}
