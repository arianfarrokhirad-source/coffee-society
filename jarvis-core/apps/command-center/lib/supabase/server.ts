import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'

type CookieItem = { name: string; value: string; options?: CookieOptions }

// Anon-key client bound to the user's session cookies. All queries made
// with this client are subject to Row Level Security.
export async function createUserClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list: CookieItem[]) => {
          try {
            list.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {
            // Server Components cannot set cookies; middleware refreshes.
          }
        },
      },
    }
  )
}
