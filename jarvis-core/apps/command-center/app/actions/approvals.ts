'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { getStore } from '@/lib/jarvis'
import { describeRpcError, PRIME_RESOLUTIONS } from '@/lib/approval-transitions'
import type { PrimeResolution } from '@/lib/approval-transitions'
import type { ActionState } from './work'

// ---------------------------------------------------------------------
// Approval resolution.
//
// The state change, its audit row and its domain event are written by
// resolve_approval in a single database transaction. Nothing here
// updates the approvals table: migration 0010 dropped the client write
// policy, so this is the only path, and a failure part-way through rolls
// back all three rather than leaving a decision with no record of who
// made it.
//
// Authorization is still enforced twice. The isPrime check below is the
// application layer; assert_org_prime inside the RPC re-derives it from
// the database. Neither is removed because the other exists.
//
// Phase 1 has no executors, so approving an external action records the
// decision and executes nothing.
// ---------------------------------------------------------------------

const schema = z.object({
  approvalId: z.string().uuid(),
  resolution: z.enum(PRIME_RESOLUTIONS),
  // Optimistic concurrency. The caller states what it believes the
  // current status to be; the database refuses the change if the record
  // moved in between, rather than silently overwriting someone else.
  expectedStatus: z.enum(['pending', 'approved', 'modified']).default('pending'),
})

export async function resolveApproval(
  approvalId: string,
  resolution: PrimeResolution,
  expectedStatus: 'pending' | 'approved' | 'modified' = 'pending'
): Promise<ActionState> {
  const auth = await getAuthContext()
  if (!auth) return { error: 'Not authenticated.' }
  if (!auth.isPrime) return { error: 'Only PRIME can resolve approvals.' }

  const parsed = schema.safeParse({ approvalId, resolution, expectedStatus })
  if (!parsed.success) return { error: 'Invalid approval resolution.' }

  try {
    await getStore().resolveApproval({
      actorId: auth.userId,
      approvalId: parsed.data.approvalId,
      expectedStatus: parsed.data.expectedStatus,
      resolution: parsed.data.resolution,
      // A fresh id per submission: this is a deliberate human decision,
      // so a second click is a second decision to record, not a retry to
      // collapse. The database still refuses a transition out of a
      // status that has already moved, which is what makes the double
      // click safe.
      requestId: randomUUID(),
      origin: 'web',
    })
  } catch (error) {
    // describeRpcError maps the database's reason identifier to a
    // message; anything unrecognised becomes a generic string, so
    // database internals never reach the browser.
    return { error: describeRpcError(error instanceof Error ? error.message : null) }
  }

  revalidatePath('/approvals')
  return { error: null, ok: true }
}
