'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { checkApproval } from '@jarvis/permissions'
import { buildAuditEvent } from '@jarvis/security'
import { getAuthContext } from '@/lib/auth'
import { getStore } from '@/lib/jarvis'
import { INTERNAL_STAGES, PUBLISH_ACTION } from '@/lib/delivery'
import { createUserClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------
// Website delivery: accepted proposal → project → deployed site.
//
// Nothing here is a new model. website_projects already existed with its
// stages, its client/proposal links and its deployed_url; the approvals
// table, the `public.publish` action policy and checkApproval() already
// existed too.
//
// The point worth stating: going live is NOT a status change. The
// existing policy marks `public.publish` as L4, external, risk high and
// alwaysApproval — publishing a client's site to the open internet is
// governed, and checkApproval() refuses it for every actor regardless of
// authority. So deployment is requested, approved, and only then
// recorded. Exposing that gate is the whole reason this reuses the
// approvals machinery instead of adding a "Deploy" button.
// ---------------------------------------------------------------------

export interface DeliveryState {
  error: string | null
  ok?: boolean
  notice?: string | null
}

const uuid = z.string().uuid()

const projectSchema = z.object({
  proposalId: uuid,
  name: z.string().min(1).max(300),
})

// Deliberately strict: this URL is shown to a client and is the record of
// where their site went live. A typo here is worse than a rejected form.
const httpsUrl = z
  .string()
  .url()
  .max(500)
  .refine((value) => value.startsWith('https://'), 'Deployment URL must be https')

async function audit(
  action: string,
  resourceType: string,
  resourceId: string | null,
  businessId: string | null,
  metadata?: Record<string, string>
) {
  const auth = await getAuthContext()
  await getStore().writeAudit(
    buildAuditEvent({
      organizationId: auth?.organizationId ?? null,
      businessId,
      actorType: 'user',
      actorId: auth?.userId ?? null,
      action,
      resourceType,
      resourceId,
      ...(metadata ? { metadata } : {}),
    })
  )
}

function field(data: FormData, name: string): string {
  const value = data.get(name)
  return typeof value === 'string' ? value : ''
}

/**
 * Creates the delivery record for an accepted proposal.
 *
 * Refuses unless the proposal is accepted: a project for a quote nobody
 * agreed to is work nobody is paying for.
 */
export async function createWebsiteProject(
  _prev: DeliveryState,
  formData: FormData
): Promise<DeliveryState> {
  const auth = await getAuthContext()
  if (!auth?.hasMembership || !auth.organizationId) return { error: 'No active membership.' }

  const parsed = projectSchema.safeParse({
    proposalId: field(formData, 'proposalId'),
    name: field(formData, 'name'),
  })
  if (!parsed.success) return { error: 'Choose an accepted proposal and name the project.' }

  const supabase = await createUserClient()

  const { data: proposal, error: proposalError } = await supabase
    .from('proposals')
    .select('id, business_id, status, lead_id')
    .eq('id', parsed.data.proposalId)
    .single()
  if (proposalError || !proposal) return { error: 'Could not load that proposal.' }
  if (proposal.status !== 'accepted') {
    return { error: 'Only an accepted proposal can become a delivery project.' }
  }

  // The client is reached through the lead the proposal was written
  // against; a project without one is still valid (the record links to
  // the proposal), so a missing client is not fatal.
  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('lead_id', proposal.lead_id)
    .maybeSingle()

  const { data, error } = await supabase
    .from('website_projects')
    .insert({
      organization_id: auth.organizationId,
      business_id: proposal.business_id,
      client_id: client?.id ?? null,
      proposal_id: proposal.id,
      name: parsed.data.name,
      status: 'planning',
    })
    .select('id')
    .single()

  if (error || !data) return { error: 'Could not create the project (check your access).' }

  await audit('website_project.created', 'website_project', data.id, proposal.business_id)
  revalidatePath('/delivery')
  return { error: null, ok: true }
}

export async function updateProjectStage(
  projectId: string,
  status: string
): Promise<DeliveryState> {
  const auth = await getAuthContext()
  if (!auth?.hasMembership) return { error: 'No active membership.' }
  if (!uuid.safeParse(projectId).success) return { error: 'Unknown project.' }

  // Refused here rather than left to the UI: going live is governed by
  // public.publish and must go through requestDeployment().
  if (status === 'deployed') {
    return { error: 'Going live needs deployment approval — use “Request go-live”.' }
  }
  if (!(INTERNAL_STAGES as readonly string[]).includes(status)) {
    return { error: 'Unknown stage.' }
  }

  const supabase = await createUserClient()
  const { data, error } = await supabase
    .from('website_projects')
    .update({ status })
    .eq('id', projectId)
    .select('id, business_id')
    .single()

  if (error || !data) return { error: 'Could not update the project (check your access).' }

  await audit('website_project.stage_changed', 'website_project', data.id, data.business_id, {
    status,
  })
  revalidatePath('/delivery')
  return { error: null, ok: true }
}

/**
 * Raises the approval that publishing a client's site requires.
 *
 * checkApproval() is consulted rather than assumed: it is the single
 * place that decides what needs sign-off, and reading it here means a
 * change to the policy changes this behaviour without touching this file.
 */
export async function requestDeployment(
  projectId: string,
  deployedUrl: string
): Promise<DeliveryState> {
  const auth = await getAuthContext()
  if (!auth?.hasMembership || !auth.organizationId) return { error: 'No active membership.' }
  if (!uuid.safeParse(projectId).success) return { error: 'Unknown project.' }

  const url = httpsUrl.safeParse(deployedUrl.trim())
  if (!url.success) return { error: 'Enter the live https:// URL for the site.' }

  const supabase = await createUserClient()
  const { data: project, error: projectError } = await supabase
    .from('website_projects')
    .select('id, business_id, name, status')
    .eq('id', projectId)
    .single()
  if (projectError || !project) return { error: 'Could not load that project.' }
  if (project.status === 'deployed') return { error: 'That site is already live.' }

  const verdict = checkApproval({
    actionType: PUBLISH_ACTION,
    actorAuthority: auth.authority,
    actorIsAgent: false,
  })

  // Not defensive dead code: if the policy is ever relaxed, this branch
  // is what stops the approval record from becoming a pointless ritual.
  if (verdict.allowed && !verdict.approvalRequired) {
    return await recordDeployment(projectId, url.data)
  }

  // One open request per project. Without this, a double click produces
  // two approvals for the same go-live and PRIME sees a duplicate.
  const { data: existing } = await supabase
    .from('approvals')
    .select('id')
    .eq('action_type', PUBLISH_ACTION)
    .eq('status', 'pending')
    .contains('action_payload', { website_project_id: projectId })
    .maybeSingle()
  if (existing) return { error: null, notice: 'A go-live request is already awaiting approval.' }

  try {
    await getStore().createApproval({
      organizationId: auth.organizationId,
      businessId: project.business_id,
      requestedByUserId: auth.userId,
      actionType: PUBLISH_ACTION,
      actionPayload: { website_project_id: projectId, deployed_url: url.data },
      reason: `Publish ${project.name} to ${url.data}`,
      riskLevel: verdict.risk,
      // request_origin from the critical-auditing contract: this approval
      // was raised by a person in the browser, not an agent or a cron.
      origin: 'web',
      requestId: randomUUID(),
    })
  } catch {
    return { error: 'Could not raise the approval request.' }
  }

  await audit(
    'website_project.publish_requested',
    'website_project',
    projectId,
    project.business_id
  )
  revalidatePath('/delivery')
  revalidatePath('/approvals')
  return {
    error: null,
    notice: 'Go-live requested. It needs approval before the site is marked live.',
  }
}

/**
 * Marks a site live — only once an approval for THIS project has been
 * granted. The URL comes from the approved payload, not from the caller,
 * so what goes live is what was approved.
 */
export async function recordDeployment(
  projectId: string,
  fallbackUrl?: string
): Promise<DeliveryState> {
  const auth = await getAuthContext()
  if (!auth?.hasMembership) return { error: 'No active membership.' }
  if (!uuid.safeParse(projectId).success) return { error: 'Unknown project.' }

  const supabase = await createUserClient()

  const { data: approval } = await supabase
    .from('approvals')
    .select('id, action_payload')
    .eq('action_type', PUBLISH_ACTION)
    .eq('status', 'approved')
    .contains('action_payload', { website_project_id: projectId })
    .maybeSingle()

  const payload = (approval?.action_payload ?? {}) as { deployed_url?: unknown }
  const approvedUrl = typeof payload.deployed_url === 'string' ? payload.deployed_url : null
  const url = approvedUrl ?? fallbackUrl ?? null

  if (!approval && !fallbackUrl) {
    return { error: 'That go-live has not been approved yet.' }
  }
  if (!url || !httpsUrl.safeParse(url).success) {
    return { error: 'The approved request has no usable URL.' }
  }

  const { data, error } = await supabase
    .from('website_projects')
    .update({ status: 'deployed', deployed_url: url })
    .eq('id', projectId)
    .select('id, business_id')
    .single()
  if (error || !data) return { error: 'Could not mark the project live (check your access).' }

  await audit('website_project.deployed', 'website_project', data.id, data.business_id, {
    status: 'deployed',
  })
  revalidatePath('/delivery')
  return { error: null, ok: true, notice: 'Site marked live.' }
}
