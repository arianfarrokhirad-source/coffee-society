'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { buildAuditEvent } from '@jarvis/security'
import { getAuthContext } from '@/lib/auth'
import { getStore } from '@/lib/jarvis'
import { createUserClient } from '@/lib/supabase/server'
import type { ActionState } from './work'

// Approval resolution. Only PRIME can approve/reject — enforced twice:
// here (application check) and by RLS (approvals update policy is
// PRIME-only), so a bug in one layer cannot bypass the other.
// Phase 1 has no executors for external actions, so approving an
// external action records the decision but executes nothing.

export async function resolveApproval(
  approvalId: string,
  resolution: 'approved' | 'rejected' | 'cancelled'
): Promise<ActionState> {
  const auth = await getAuthContext()
  if (!auth) return { error: 'Not authenticated.' }
  if (!auth.isPrime) return { error: 'Only PRIME can resolve approvals.' }

  const parsed = z
    .object({
      approvalId: z.string().uuid(),
      resolution: z.enum(['approved', 'rejected', 'cancelled']),
    })
    .safeParse({ approvalId, resolution })
  if (!parsed.success) return { error: 'Invalid approval resolution.' }

  const supabase = await createUserClient()
  const { data: before } = await supabase
    .from('approvals')
    .select('id, status, action_type, business_id')
    .eq('id', parsed.data.approvalId)
    .maybeSingle()
  if (!before) return { error: 'Approval not found.' }
  if (before.status !== 'pending') return { error: `Approval is already ${before.status}.` }

  const { error } = await supabase
    .from('approvals')
    .update({
      status: parsed.data.resolution,
      approved_by: auth.userId,
      approved_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.approvalId)
    .eq('status', 'pending')
  if (error) return { error: 'Could not update approval.' }

  const store = getStore()
  await store.writeAudit(
    buildAuditEvent({
      organizationId: auth.organizationId,
      businessId: (before.business_id as string | null) ?? null,
      actorType: 'user',
      actorId: auth.userId,
      action: `approval.${parsed.data.resolution}`,
      resourceType: 'approval',
      resourceId: before.id as string,
      beforeData: { status: 'pending' },
      afterData: { status: parsed.data.resolution },
    })
  )
  if (auth.organizationId) {
    await store.createSystemEvent({
      organizationId: auth.organizationId,
      eventType: `approval.${parsed.data.resolution}`,
      payload: { approvalId: before.id, actionType: before.action_type },
      dedupeKey: `${before.id}:${parsed.data.resolution}`,
    })
  }
  revalidatePath('/approvals')
  return { error: null, ok: true }
}
