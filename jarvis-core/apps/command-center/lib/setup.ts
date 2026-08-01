import 'server-only'
import { createServiceClient } from '@jarvis/database'

/**
 * True when a PRIME membership exists. Used only to decide whether to
 * show the one-time "Claim PRIME" setup banner; the actual claim is
 * enforced atomically inside the claim_prime() database function.
 */
export async function primeExists(): Promise<boolean> {
  try {
    const service = createServiceClient()
    const { data: role } = await service.from('roles').select('id').eq('key', 'prime').maybeSingle()
    if (!role) return false
    const { count } = await service
      .from('memberships')
      .select('id', { count: 'exact', head: true })
      .eq('role_id', role.id)
      .eq('status', 'active')
    return (count ?? 0) > 0
  } catch {
    // Missing service credentials in this environment — assume set up.
    return true
  }
}
