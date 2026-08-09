'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { RISK_LEVELS } from '@jarvis/shared'
import { buildAuditEvent } from '@jarvis/security'
import { getAuthContext } from '@/lib/auth'
import { getStore } from '@/lib/jarvis'
import { createUserClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------
// Website audits — the diagnostic that justifies a quote.
//
// Nothing new is modelled. website_audits already existed with findings
// (jsonb), a 0–100 score, a draft/completed status and a lead link; the
// funnel it belongs to was already in the schema too — leads carry an
// `audit_scheduled` status and proposals carry an `audit_id`.
//
// Severity reuses RISK_LEVELS from @jarvis/shared rather than inventing a
// second scale. Two severity vocabularies in one product is how a "high"
// in one screen stops meaning a "high" in another.
//
// No action policy is consulted: an audit is internal analysis with no
// external side effect. There is deliberately no `audit.*` entry in
// ACTION_POLICIES, and inventing one would be adding governance nobody
// asked for.
// ---------------------------------------------------------------------

export interface AuditState {
  error: string | null
  ok?: boolean
}

const uuid = z.string().uuid()

const findingSchema = z.object({
  area: z.string().min(1).max(120),
  issue: z.string().min(1).max(500),
  severity: z.enum(RISK_LEVELS),
})

export type AuditFinding = z.infer<typeof findingSchema>

const auditSchema = z.object({
  leadId: uuid,
  // A URL is useful but not required: an audit of a business with no
  // website at all is a legitimate — and very sellable — finding.
  websiteUrl: z
    .string()
    .max(500)
    .transform((value) => (value.trim() === '' ? undefined : value.trim()))
    .optional(),
  score: z.coerce.number().int().min(0).max(100).optional(),
  summary: z
    .string()
    .max(5000)
    .transform((value) => (value.trim() === '' ? undefined : value.trim()))
    .optional(),
})

async function audit(
  action: string,
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
      resourceType: 'website_audit',
      resourceId,
      ...(metadata ? { metadata } : {}),
    })
  )
}

function field(data: FormData, name: string): string {
  const value = data.get(name)
  return typeof value === 'string' ? value : ''
}

/** Reads the repeated area/issue/severity rows; blank rows are skipped. */
function readFindings(formData: FormData): AuditFinding[] {
  const findings: AuditFinding[] = []
  for (const [key, value] of formData.entries()) {
    const match = /^finding_(\d+)_issue$/.exec(key)
    if (!match || typeof value !== 'string' || value.trim() === '') continue
    const parsed = findingSchema.safeParse({
      area: field(formData, `finding_${match[1]}_area`) || 'General',
      issue: value.trim(),
      severity: field(formData, `finding_${match[1]}_severity`) || 'medium',
    })
    if (parsed.success) findings.push(parsed.data)
  }
  return findings
}

export async function createAudit(_prev: AuditState, formData: FormData): Promise<AuditState> {
  const auth = await getAuthContext()
  if (!auth?.hasMembership || !auth.organizationId) return { error: 'No active membership.' }

  const parsed = auditSchema.safeParse({
    leadId: field(formData, 'leadId'),
    websiteUrl: field(formData, 'websiteUrl'),
    score: field(formData, 'score') || undefined,
    summary: field(formData, 'summary'),
  })
  if (!parsed.success) return { error: 'Choose a lead, and give a score between 0 and 100.' }

  const findings = readFindings(formData)
  if (findings.length === 0) return { error: 'Record at least one finding.' }

  const supabase = await createUserClient()

  // Scope and the fallback URL both come from the lead the database
  // returned, never from the form.
  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('id, business_id, website_url, status')
    .eq('id', parsed.data.leadId)
    .single()
  if (leadError || !lead) return { error: 'Could not load that lead (check your access).' }

  const { data, error } = await supabase
    .from('website_audits')
    .insert({
      organization_id: auth.organizationId,
      business_id: lead.business_id,
      lead_id: lead.id,
      website_url: parsed.data.websiteUrl ?? lead.website_url ?? null,
      // findings defaults to '{}' in the schema — an object, not an array —
      // so the shape stays an object with the list inside it.
      findings: { items: findings, summary: parsed.data.summary ?? null },
      score: parsed.data.score ?? null,
      status: 'draft',
      created_by: auth.userId,
    })
    .select('id')
    .single()

  if (error || !data) return { error: 'Could not save the audit (check your access).' }

  await audit('website_audit.created', data.id, lead.business_id)

  // Booking an audit is what the `audit_scheduled` stage means. Moving
  // the lead here keeps the pipeline honest without a second click; a
  // lead already further along is left alone.
  if (lead.status === 'new' || lead.status === 'contacted' || lead.status === 'qualified') {
    const { error: leadUpdate } = await supabase
      .from('leads')
      .update({ status: 'audit_scheduled' })
      .eq('id', lead.id)
    if (!leadUpdate) {
      await audit('lead.status_changed', lead.id, lead.business_id, { status: 'audit_scheduled' })
    }
  }

  revalidatePath('/audits')
  revalidatePath('/clients')
  return { error: null, ok: true }
}

/**
 * Marks an audit finished so it can be cited by a proposal.
 *
 * Completion is one-way. An audit is evidence shown to a client; editing
 * it after the quote went out would rewrite the justification for a price
 * they already saw.
 */
export async function completeAudit(auditId: string): Promise<AuditState> {
  const auth = await getAuthContext()
  if (!auth?.hasMembership) return { error: 'No active membership.' }
  if (!uuid.safeParse(auditId).success) return { error: 'Unknown audit.' }

  const supabase = await createUserClient()
  const { data: existing, error: readError } = await supabase
    .from('website_audits')
    .select('id, business_id, status')
    .eq('id', auditId)
    .single()
  if (readError || !existing) return { error: 'Could not load that audit (check your access).' }
  if (existing.status === 'completed') return { error: 'That audit is already completed.' }

  const { error } = await supabase
    .from('website_audits')
    .update({ status: 'completed' })
    .eq('id', auditId)
  if (error) return { error: 'Could not complete the audit.' }

  await audit('website_audit.completed', auditId, existing.business_id, { status: 'completed' })
  revalidatePath('/audits')
  revalidatePath('/proposals')
  return { error: null, ok: true }
}
