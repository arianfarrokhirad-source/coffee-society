// Safe error surfaces: ordinary users never see stack traces or
// internal details. Full errors belong in server logs / audit only.

export interface SafeError {
  message: string
  code: string
  requestId?: string
}

const GENERIC_MESSAGE = 'Something went wrong. The error has been logged.'

export function toSafeError(
  error: unknown,
  code = 'internal_error',
  requestId?: string
): SafeError {
  // Only allowlisted, intentionally-thrown messages pass through.
  if (error instanceof PublicError) {
    return { message: error.message, code: error.code, requestId }
  }
  return { message: GENERIC_MESSAGE, code, requestId }
}

/** An error whose message is safe to show to the end user. */
export class PublicError extends Error {
  code: string
  constructor(message: string, code = 'bad_request') {
    super(message)
    this.name = 'PublicError'
    this.code = code
  }
}
