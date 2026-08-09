import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------
// Client factories. The service-role client must ONLY ever be created
// in server-side code paths; the key never reaches the browser. The
// Next.js app additionally wraps the anon client with cookie handling
// via @supabase/ssr (see apps/command-center/lib/supabase).
// ---------------------------------------------------------------------

export interface SupabaseEnv {
  url: string
  anonKey: string
  serviceRoleKey?: string
}

export function readSupabaseEnv(): SupabaseEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.example)'
    )
  }
  return { url, anonKey, serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY }
}

/**
 * Service-role client. Bypasses RLS — every use must be preceded by an
 * application-level permission check and followed by audit logging.
 * Throws when imported into a browser bundle.
 */
export function createServiceClient(env?: SupabaseEnv): SupabaseClient {
  if (typeof globalThis !== 'undefined' && 'window' in globalThis) {
    throw new Error('createServiceClient must never run in the browser')
  }
  const resolved = env ?? readSupabaseEnv()
  if (!resolved.serviceRoleKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY (server-only, see .env.example)')
  }
  return createClient(resolved.url, resolved.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
