import { z } from 'zod'

// ---------------------------------------------------------------------
// Registration validation and derived values.
//
// Pure and dependency-free so it is unit-testable without a database or
// a browser, and so the server action has exactly one place to reject
// input before anything reaches Supabase. That ordering matters: the
// signup trigger runs inside the auth.users insert, and a trigger
// failure there aborts account creation with no user row. Rejecting
// here is the primary control; the database guards are the backstop.
//
// AGE IS NEVER STORED. `calculateAge` derives it from date_of_birth at
// read time — there is no age column, and check 1 of
// supabase/tests/registration_verification.sql asserts there never is.
// ---------------------------------------------------------------------

/** Matches profiles_phone_e164 in migration 0011. */
export const E164 = /^\+[1-9][0-9]{7,14}$/

/** Matches profiles_dob_floor in migration 0011. */
export const EARLIEST_BIRTH_DATE = '1900-01-01'

export const MIN_PASSWORD_LENGTH = 10
export const MAX_PASSWORD_LENGTH = 200
export const MAX_DISPLAY_NAME_LENGTH = 200

/**
 * Parses a YYYY-MM-DD string strictly. `new Date('2024-02-31')` rolls
 * over to 2 March rather than failing, so the round-trip comparison is
 * what actually rejects impossible dates.
 */
export function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  const date = new Date(Date.UTC(y, m - 1, d))
  // Date.UTC rolls 2024-02-31 over to 2 March instead of failing, so the
  // round trip is what actually rejects an impossible date.
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null
  }
  return date
}

/**
 * True when the date is a usable birth date: strictly after 1900-01-01
 * and strictly before today. Mirrors what the database enforces —
 * profiles_dob_floor plus the validate_profile_identity trigger — so a
 * value accepted here can never be rejected by the database.
 */
export function isUsableBirthDate(value: string, today: Date = new Date()): boolean {
  const date = parseIsoDate(value)
  if (!date) return false
  const floor = parseIsoDate(EARLIEST_BIRTH_DATE)!
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  return date.getTime() > floor.getTime() && date.getTime() < todayUtc
}

/**
 * Completed years between a birth date and a reference day. Computed,
 * never persisted. Returns null when the input is unusable rather than
 * guessing.
 */
export function calculateAge(
  dateOfBirth: string | null | undefined,
  today: Date = new Date()
): number | null {
  if (!dateOfBirth) return null
  const born = parseIsoDate(dateOfBirth)
  if (!born) return null

  const y = today.getUTCFullYear()
  const m = today.getUTCMonth()
  const d = today.getUTCDate()

  let age = y - born.getUTCFullYear()
  // Subtract a year when this year's birthday has not happened yet.
  const monthDiff = m - born.getUTCMonth()
  if (monthDiff < 0 || (monthDiff === 0 && d < born.getUTCDate())) age -= 1
  return age < 0 ? null : age
}

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? undefined : v))
  .optional()

export const registrationSchema = z
  .object({
    displayName: z.string().trim().min(1).max(MAX_DISPLAY_NAME_LENGTH),
    email: z.string().trim().email().max(200),
    password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
    confirmPassword: z.string().min(1),
    phone: optionalText.refine((v) => v === undefined || E164.test(v), {
      message: 'phone_invalid',
    }),
    dateOfBirth: optionalText.refine((v) => v === undefined || isUsableBirthDate(v), {
      message: 'date_of_birth_invalid',
    }),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'password_mismatch',
    path: ['confirmPassword'],
  })

export type RegistrationInput = z.infer<typeof registrationSchema>

/**
 * The ONLY fields that may be sent to Supabase as user metadata.
 *
 * raw_user_meta_data is client-controlled and is read by
 * handle_new_user, so this function is the boundary that keeps two
 * promises: passwords never leave the action, and nothing
 * privilege-bearing (role, authority, organization, business,
 * membership) is ever offered to the trigger. Optional fields are
 * omitted rather than sent as null.
 */
export function buildSignupMetadata(input: RegistrationInput): Record<string, string> {
  const metadata: Record<string, string> = { display_name: input.displayName }
  if (input.phone) metadata.phone = input.phone
  if (input.dateOfBirth) metadata.date_of_birth = input.dateOfBirth
  return metadata
}

/** Field-level messages. Generic by design; no value is echoed back. */
export const REGISTRATION_FIELD_ERRORS: Record<string, string> = {
  displayName: 'Enter your full name.',
  email: 'Enter a valid email address.',
  password: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
  confirmPassword: 'Passwords do not match.',
  phone: 'Enter a phone number in international format, for example +447700900123.',
  dateOfBirth: 'Enter a real date of birth in the past (YYYY-MM-DD).',
}

/** First field-level problem, or null when the payload is valid. */
export function firstFieldError(issues: z.ZodIssue[]): string | null {
  for (const issue of issues) {
    const field = issue.path[0]
    if (typeof field === 'string' && REGISTRATION_FIELD_ERRORS[field]) {
      return REGISTRATION_FIELD_ERRORS[field]
    }
  }
  return issues.length > 0 ? 'Check the form and try again.' : null
}
