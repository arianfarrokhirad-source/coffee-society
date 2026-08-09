'use server'

import { revalidatePath } from 'next/cache'
import { generateDailyBrief } from '@jarvis/reporting'
import { checkApproval } from '@jarvis/permissions'
import { buildAuditEvent } from '@jarvis/security'
import { getAuthContext } from '@/lib/auth'
import { getStore } from '@/lib/jarvis'
import type { ActionState } from './work'

export async function generateBriefAction(): Promise<ActionState> {
  const auth = await getAuthContext()
  if (!auth?.hasMembership || !auth.organizationId) return { error: 'No active membership.' }

  // Application-level permission check (brief.generate requires L2).
  const check = checkApproval({
    actionType: 'brief.generate',
    actorAuthority: auth.authority,
    actorIsAgent: false,
  })
  if (!check.allowed) return { error: `Not permitted: ${check.reason}` }

  const store = getStore()
  try {
    await generateDailyBrief(store, {
      organizationId: auth.organizationId,
      generatedBy: auth.userId,
    })
  } catch {
    return { error: 'Brief generation failed. Check server logs.' }
  }
  await store.writeAudit(
    buildAuditEvent({
      organizationId: auth.organizationId,
      actorType: 'user',
      actorId: auth.userId,
      action: 'brief.generated',
      resourceType: 'daily_brief',
    })
  )
  revalidatePath('/reports')
  return { error: null, ok: true }
}
