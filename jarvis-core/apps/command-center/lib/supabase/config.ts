// ---------------------------------------------------------------------
// Supabase configuration self-check.
//
// Diagnoses the one misconfiguration that is invisible from the outside
// and produces a confusing, credential-shaped failure: an anon key that
// does not belong to the project at NEXT_PUBLIC_SUPABASE_URL.
//
// When that happens the Supabase API gateway rejects the request BEFORE
// GoTrue ever sees it, with HTTP 401 and a body carrying no `code`
// field. Every genuine GoTrue refusal — signups disabled, weak password,
// email exists — carries a code. So "401 and no code" is the signature
// of a key/project mismatch rather than anything the user typed.
//
// SECRET DISCIPLINE
//
// Nothing here returns, logs or renders key material. It reads only the
// PUBLIC claims of the anon key: a Supabase anon key is a JWT whose
// payload states its project ref and its role, and that payload is
// already visible to every browser that loads the app — as is the
// project ref in the URL. Comparing the two is therefore free of
// disclosure risk, while the signature and any other credential are
// never touched.
// ---------------------------------------------------------------------

export interface SupabaseConfigStatus {
  urlPresent: boolean
  anonKeyPresent: boolean
  /** Project ref parsed from the URL host, e.g. `abcdefgh` of abcdefgh.supabase.co. */
  urlRef: string | null
  /** Project ref claimed by the anon key. Null for non-JWT publishable keys. */
  keyRef: string | null
  /** Role claimed by the key. Must be `anon` on this path. */
  keyRole: string | null
  /** True when the key's `exp` is in the past. */
  keyExpired: boolean
  /**
   * Whether key and URL agree.
   *
   * `null` means "cannot tell" — a publishable key carries no ref, and
   * saying "mismatch" there would be a false accusation.
   */
  refsMatch: boolean | null
  /** True when the key claims a privileged role on a browser-facing path. */
  serviceRoleMisplaced: boolean
}

/** Project ref from a Supabase URL, without validating the whole URL. */
export function projectRefFromUrl(url: string | undefined): string | null {
  if (!url) return null
  try {
    const host = new URL(url).hostname
    const [first, ...rest] = host.split('.')
    // Only treat the first label as a ref on a supabase-hosted domain;
    // a self-hosted or custom domain has no ref to compare against.
    if (!first || rest.length === 0) return null
    if (!host.endsWith('.supabase.co') && !host.endsWith('.supabase.in')) return null
    return first
  } catch {
    return null
  }
}

interface AnonKeyClaims {
  ref: string | null
  role: string | null
  exp: number | null
}

/**
 * Reads the public claims of a Supabase JWT key.
 *
 * Deliberately does NOT verify the signature: this is a configuration
 * sanity check, not an authentication decision. Verification is the
 * Supabase gateway's job and duplicating it here would need the
 * project's secret, which this process must never hold.
 */
export function readAnonKeyClaims(key: string | undefined): AnonKeyClaims {
  const empty: AnonKeyClaims = { ref: null, role: null, exp: null }
  if (!key) return empty

  const parts = key.split('.')
  const payload = parts[1]
  // Newer publishable keys (`sb_publishable_…`) are opaque, not JWTs.
  // Absence of claims is a fact, not a fault.
  if (parts.length !== 3 || !payload) return empty

  try {
    const normalised = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalised.padEnd(Math.ceil(normalised.length / 4) * 4, '=')
    const decoded: unknown = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
    if (typeof decoded !== 'object' || decoded === null) return empty
    const claims = decoded as { ref?: unknown; role?: unknown; exp?: unknown }
    return {
      ref: typeof claims.ref === 'string' ? claims.ref : null,
      role: typeof claims.role === 'string' ? claims.role : null,
      exp: typeof claims.exp === 'number' ? claims.exp : null,
    }
  } catch {
    return empty
  }
}

export function readSupabaseConfigStatus(now: number = Date.now()): SupabaseConfigStatus {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  const urlRef = projectRefFromUrl(url)
  const claims = readAnonKeyClaims(anonKey)

  return {
    urlPresent: typeof url === 'string' && url.length > 0,
    anonKeyPresent: typeof anonKey === 'string' && anonKey.length > 0,
    urlRef,
    keyRef: claims.ref,
    keyRole: claims.role,
    keyExpired: claims.exp != null && claims.exp * 1000 < now,
    refsMatch: urlRef && claims.ref ? urlRef === claims.ref : null,
    // A service_role key on the browser-facing variable is both a
    // configuration error and a credential leak: NEXT_PUBLIC_ values are
    // compiled into the client bundle.
    serviceRoleMisplaced: claims.role === 'service_role',
  }
}

/**
 * True when configuration alone explains an auth rejection.
 *
 * Only returns true on evidence, never on absence of evidence — a
 * publishable key with no ref to compare is reported as "cannot tell"
 * upstream and does not trip this.
 */
export function configurationIsBroken(status: SupabaseConfigStatus): boolean {
  return (
    !status.urlPresent ||
    !status.anonKeyPresent ||
    status.refsMatch === false ||
    status.keyExpired ||
    status.serviceRoleMisplaced
  )
}

/**
 * A short, non-secret summary for server logs.
 *
 * Project refs are included because they are already public — the ref is
 * the subdomain of the URL the browser connects to. No key material, no
 * signature, no PII.
 */
export function describeConfigForLog(status: SupabaseConfigStatus): Record<string, unknown> {
  return {
    url_present: status.urlPresent,
    anon_key_present: status.anonKeyPresent,
    url_ref: status.urlRef,
    key_ref: status.keyRef,
    key_role: status.keyRole,
    key_expired: status.keyExpired,
    refs_match: status.refsMatch,
    service_role_misplaced: status.serviceRoleMisplaced,
  }
}
