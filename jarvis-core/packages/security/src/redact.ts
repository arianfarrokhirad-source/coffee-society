// Secret redaction for anything persisted to logs/audit. Applied before
// writing before/after payloads, tool arguments or error details.

const SENSITIVE_KEY = /(key|secret|token|password|credential|authorization|cookie|signature)/i

// Personal identity data. Supabase is the authoritative and ONLY store
// for these (see docs/codebase/context/SECURITY_CONTEXT.md); they must
// never be written to graph memory, the Obsidian vault, telemetry or
// audit payloads. This list is DEFENCE IN DEPTH — the control is not
// putting them in a payload in the first place.
const IDENTITY_KEY =
  /^(display_name|displayName|full_name|fullName|phone|phone_number|phoneNumber|date_of_birth|dateOfBirth|dob|birth_date|birthDate)$/i
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
    out[k] =
      SENSITIVE_KEY.test(k) || IDENTITY_KEY.test(k) ? '[REDACTED]' : redactSecrets(v, depth + 1)
  }
  return out
}
