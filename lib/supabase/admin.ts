import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazily initialised so importing this module never throws at build time
// (page-data collection) when env vars are absent. The client is created
// on first use; missing env then surfaces as a clear runtime error.
let client: SupabaseClient | null = null

function getAdminClient(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) {
      throw new Error(
        'Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (see .env.example)'
      )
    }
    client = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  }
  return client
}

export const adminClient: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const real = getAdminClient()
    const value = Reflect.get(real, prop, real)
    return typeof value === 'function' ? value.bind(real) : value
  },
})
