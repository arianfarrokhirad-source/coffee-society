import { cache } from 'react'
import type { AuthorityLevel, RoleKey } from '@jarvis/shared'
import { createUserClient } from './supabase/server'

export interface MembershipInfo {
  organizationId: string
  businessId: string | null
  roleKey: RoleKey
  authority: AuthorityLevel
}

export interface AuthContext {
  userId: string
  email: string | null
  displayName: string | null
  memberships: MembershipInfo[]
  organizationId: string | null
  authority: AuthorityLevel
  isPrime: boolean
  hasMembership: boolean
}

const rank = (a: AuthorityLevel) => Number(a.slice(1))

/**
 * Resolve the authenticated user's identity + memberships via the
 * RLS-scoped client (a user can only ever read their own memberships).
 * Cached per request.
 */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const supabase = await createUserClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const [{ data: profile }, { data: membershipRows }] = await Promise.all([
    supabase.from('profiles').select('display_name, email').eq('id', user.id).maybeSingle(),
    supabase
      .from('memberships')
      .select('organization_id, business_id, authority_level, status, roles(key)')
      .eq('profile_id', user.id)
      .eq('status', 'active'),
  ])

  const memberships: MembershipInfo[] = (membershipRows ?? []).map((m) => ({
    organizationId: m.organization_id as string,
    businessId: (m.business_id as string | null) ?? null,
    roleKey: ((m.roles as { key?: string } | null)?.key ?? 'employee') as RoleKey,
    authority: m.authority_level as AuthorityLevel,
  }))

  const isPrime = memberships.some((m) => m.roleKey === 'prime')
  const authority = memberships.reduce<AuthorityLevel>(
    (max, m) => (rank(m.authority) > rank(max) ? m.authority : max),
    'L0'
  )

  return {
    userId: user.id,
    email: profile?.email ?? user.email ?? null,
    displayName: profile?.display_name ?? null,
    memberships,
    organizationId: memberships[0]?.organizationId ?? null,
    authority,
    isPrime,
    hasMembership: memberships.length > 0,
  }
})
