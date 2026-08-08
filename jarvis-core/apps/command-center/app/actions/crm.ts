'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { buildAuditEvent } from '@jarvis/security'
import { getAuthContext } from '@/lib/auth'
import { getStore } from '@/lib/jarvis'
import { createUserClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------
// Client pipeline: lead → qualified → proposal → won → client.
//
// Every write goes through the USER's RLS-scoped client, so the database
// enforces business scope and role access. These actions add input
// validation and audit logging on top — they never widen access.
//
// The `client` role is excluded from has_business_access(), so lead and
// client contact details stay internal even though clients themselves
// will later have portal accounts.
// ---------------------------------------------------------------------

export interface CrmState {
  error: string | null
  ok?: boolean
}

export const LEAD_STATUSES = [
  'new',
  'contacted',
  'qualified',
  'audit_scheduled',
  'proposal_sent',
  'won',
  'lost',
  'archived',
] as const

const uuid = z.string().uuid()
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .or(z.literal('').transform(() => undefined))

const leadSchema = z.object({
  businessId: uuid,
  companyName: z.string().min(1).max(200),
  contactName: optionalText(200),
  // Not .email(): a half-known contact is still worth capturing, and
  // refusing the whole lead over a malformed address loses the lead.
  contactEmail: optionalText(200),
  contactPhone: optionalText(50),
  websiteUrl: optionalText(500),
  source: optionalText(100),
  notes: optionalText(5000),
})

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

export async function createLead(_prev: CrmState, formData: FormData): Promise<CrmState> {
  const auth = await getAuthContext()
  if (!auth?.hasMembership || !auth.organizationId) return { error: 'No active membership.' }

  const parsed = leadSchema.safeParse({
    businessId: field(formData, 'businessId'),
    companyName: field(formData, 'companyName'),
    contactName: field(formData, 'contactName'),
    contactEmail: field(formData, 'contactEmail'),
    contactPhone: field(formData, 'contactPhone'),
    websiteUrl: field(formData, 'websiteUrl'),
    source: field(formData, 'source'),
    notes: field(formData, 'notes'),
  })
  if (!parsed.success) {
    return { error: 'Enter at least a business and a company name.' }
  }

  const supabase = await createUserClient()
  const { data, error } = await supabase
    .from('leads')
    .insert({
      organization_id: auth.organizationId,
      business_id: parsed.data.businessId,
      company_name: parsed.data.companyName,
      contact_name: parsed.data.contactName ?? null,
      contact_email: parsed.data.contactEmail ?? null,
      contact_phone: parsed.data.contactPhone ?? null,
      website_url: parsed.data.websiteUrl ?? null,
      source: parsed.data.source ?? null,
      notes: parsed.data.notes ?? null,
      status: 'new',
      created_by: auth.userId,
    })
    .select('id')
    .single()

  if (error || !data) return { error: 'Could not create the lead (check your access).' }

  // Contact details are deliberately not in the audit metadata — the row
  // holds them under RLS; the trail records that a lead was created.
  await audit('lead.created', 'lead', data.id, parsed.data.businessId)
  revalidatePath('/clients')
  return { error: null, ok: true }
}

export async function updateLeadStatus(leadId: string, status: string): Promise<CrmState> {
  const auth = await getAuthContext()
  if (!auth?.hasMembership) return { error: 'No active membership.' }
  if (!uuid.safeParse(leadId).success) return { error: 'Unknown lead.' }
  if (!(LEAD_STATUSES as readonly string[]).includes(status)) {
    return { error: 'Unknown status.' }
  }

  const supabase = await createUserClient()
  const { data, error } = await supabase
    .from('leads')
    .update({ status })
    .eq('id', leadId)
    .select('id, business_id')
    .single()

  if (error || !data) return { error: 'Could not update the lead (check your access).' }

  await audit('lead.status_changed', 'lead', data.id, data.business_id, { status })
  revalidatePath('/clients')
  return { error: null, ok: true }
}

/**
 * Converts a won lead into a client.
 *
 * The commercially important moment in the funnel, so it is deliberately
 * conservative: it refuses if the lead already has a client, and it marks
 * the lead `won` in the same flow. It is NOT transactional — PostgREST
 * has no multi-statement transaction — so the order matters: create the
 * client first, then mark the lead. A failure between the two leaves a
 * client with a lead still marked `proposal_sent`, which is visible and
 * fixable. The reverse order could mark a lead won with no client, which
 * looks like revenue that does not exist.
 */
export async function convertLeadToClient(leadId: string): Promise<CrmState> {
  const auth = await getAuthContext()
  if (!auth?.hasMembership || !auth.organizationId) return { error: 'No active membership.' }
  if (!uuid.safeParse(leadId).success) return { error: 'Unknown lead.' }

  const supabase = await createUserClient()

  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('id, business_id, company_name, contact_name, contact_email')
    .eq('id', leadId)
    .single()
  if (leadError || !lead) return { error: 'Could not load that lead (check your access).' }

  const { data: existing } = await supabase
    .from('clients')
    .select('id')
    .eq('lead_id', leadId)
    .maybeSingle()
  if (existing) return { error: 'That lead has already been converted.' }

  const { data: client, error: clientError } = await supabase
    .from('clients')
    .insert({
      organization_id: auth.organizationId,
      business_id: lead.business_id,
      lead_id: lead.id,
      company_name: lead.company_name,
      contact_name: lead.contact_name,
      contact_email: lead.contact_email,
      status: 'active',
    })
    .select('id')
    .single()
  if (clientError || !client) return { error: 'Could not create the client record.' }

  await audit('client.created', 'client', client.id, lead.business_id)

  const { error: statusError } = await supabase
    .from('leads')
    .update({ status: 'won' })
    .eq('id', leadId)
  if (statusError) {
    // The client exists, which is the part that matters. Report the
    // partial outcome rather than pretending it fully succeeded.
    return {
      error: 'Client created, but the lead status could not be updated. Set it to won manually.',
    }
  }

  await audit('lead.status_changed', 'lead', lead.id, lead.business_id, { status: 'won' })
  revalidatePath('/clients')
  return { error: null, ok: true }
}

// ---------------------------------------------------------------------
// Proposals — where money enters the pipeline.
//
// The proposals table already carries line_items, total_amount, currency
// and an approval_id hook into the existing approvals system. This
// exposes the record and its lifecycle; the approval linkage is NOT
// wired yet and pending_approval is therefore set by hand rather than by
// an approval being raised. Said plainly so nobody assumes a sign-off
// gate exists that does not.
// ---------------------------------------------------------------------

export const PROPOSAL_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'sent',
  'accepted',
  'declined',
  'expired',
] as const

/** A single priced line. Amount is minor-unit-agnostic decimal text. */
const lineItemSchema = z.object({
  description: z.string().min(1).max(300),
  amount: z.number().finite().min(0),
})

const proposalSchema = z.object({
  leadId: uuid,
  title: z.string().min(1).max(300),
  summary: optionalText(5000),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, 'Currency must be a three-letter code')
    .default('EUR'),
})

/**
 * Reads the repeated description/amount pairs off the form.
 *
 * A row with no description is skipped rather than rejected — an empty
 * spare row is the normal state of a form with fixed slots, not an
 * error worth blocking a proposal over.
 */
function readLineItems(formData: FormData): { description: string; amount: number }[] {
  const items: { description: string; amount: number }[] = []
  for (const [key, value] of formData.entries()) {
    const match = /^item_(\d+)_description$/.exec(key)
    if (!match || typeof value !== 'string' || value.trim() === '') continue
    const rawAmount = formData.get(`item_${match[1]}_amount`)
    const amount = Number(typeof rawAmount === 'string' ? rawAmount : '')
    const parsed = lineItemSchema.safeParse({
      description: value.trim(),
      amount: Number.isFinite(amount) ? amount : 0,
    })
    if (parsed.success) items.push(parsed.data)
  }
  return items
}

export async function createProposal(_prev: CrmState, formData: FormData): Promise<CrmState> {
  const auth = await getAuthContext()
  if (!auth?.hasMembership || !auth.organizationId) return { error: 'No active membership.' }

  const parsed = proposalSchema.safeParse({
    leadId: field(formData, 'leadId'),
    title: field(formData, 'title'),
    summary: field(formData, 'summary'),
    currency: field(formData, 'currency') || 'EUR',
  })
  if (!parsed.success) return { error: 'Choose a lead and give the proposal a title.' }

  const lineItems = readLineItems(formData)
  if (lineItems.length === 0) return { error: 'Add at least one line item.' }

  const supabase = await createUserClient()

  // business_id comes from the lead the database returns, never from the
  // form — otherwise a caller could file a proposal against a business
  // they cannot see.
  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('id, business_id')
    .eq('id', parsed.data.leadId)
    .single()
  if (leadError || !lead) return { error: 'Could not load that lead (check your access).' }

  // Total is derived, never taken from the client: a submitted total that
  // disagrees with its own line items is how a quote goes out wrong.
  const total = lineItems.reduce((sum, item) => sum + item.amount, 0)

  const { data, error } = await supabase
    .from('proposals')
    .insert({
      organization_id: auth.organizationId,
      business_id: lead.business_id,
      lead_id: lead.id,
      title: parsed.data.title,
      summary: parsed.data.summary ?? null,
      line_items: lineItems,
      total_amount: total,
      currency: parsed.data.currency,
      status: 'draft',
      created_by: auth.userId,
    })
    .select('id')
    .single()

  if (error || !data) return { error: 'Could not create the proposal (check your access).' }

  await audit('proposal.created', 'proposal', data.id, lead.business_id, {
    currency: parsed.data.currency,
  })
  revalidatePath('/proposals')
  revalidatePath('/clients')
  return { error: null, ok: true }
}

export async function updateProposalStatus(proposalId: string, status: string): Promise<CrmState> {
  const auth = await getAuthContext()
  if (!auth?.hasMembership) return { error: 'No active membership.' }
  if (!uuid.safeParse(proposalId).success) return { error: 'Unknown proposal.' }
  if (!(PROPOSAL_STATUSES as readonly string[]).includes(status)) {
    return { error: 'Unknown status.' }
  }

  const supabase = await createUserClient()
  const { data, error } = await supabase
    .from('proposals')
    .update({ status })
    .eq('id', proposalId)
    .select('id, business_id, lead_id')
    .single()

  if (error || !data) return { error: 'Could not update the proposal (check your access).' }

  await audit('proposal.status_changed', 'proposal', data.id, data.business_id, { status })

  // Sending a proposal is what moves the lead on. Keeping the two in step
  // here means the pipeline board cannot disagree with the proposal list.
  if (status === 'sent' && data.lead_id) {
    const { error: leadError } = await supabase
      .from('leads')
      .update({ status: 'proposal_sent' })
      .eq('id', data.lead_id)
    if (!leadError) {
      await audit('lead.status_changed', 'lead', data.lead_id, data.business_id, {
        status: 'proposal_sent',
      })
    }
  }

  revalidatePath('/proposals')
  revalidatePath('/clients')
  return { error: null, ok: true }
}
