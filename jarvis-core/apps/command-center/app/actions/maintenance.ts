'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { buildAuditEvent } from '@jarvis/security'
import { getAuthContext } from '@/lib/auth'
import { getStore } from '@/lib/jarvis'
import { MAINTENANCE_STATUSES, type MaintenanceStatus } from '@/lib/maintenance'
import { createUserClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------
// Maintenance plans — the recurring-revenue surface.
//
// Nothing new is modelled. maintenance_plans already existed with a
// client link, a website_project link, monthly_amount, a currency and an
// active/paused/cancelled lifecycle.
//
// Two things the schema settles that are worth stating, because both
// invite over-building:
//
//   There is NO cadence column. Monthly is implied by the column being
//   called monthly_amount. So no billing interval, no proration, no
//   subscription engine — the schema is describing a recurring
//   commitment, not operating one. Invoicing lives wherever invoicing
//   lives; this records what was agreed.
//
//   There is no approval policy for maintenance, and none is invented
//   here. ACTION_POLICIES gates actions with EXTERNAL side effects —
//   public.publish is L4 because it puts something on the internet.
//   Recording an agreed retainer is internal bookkeeping. Adding a gate
//   nobody asked for trains people to click through gates.
// ---------------------------------------------------------------------

export interface MaintenanceState {
  error: string | null
  ok?: boolean
}

const uuid = z.string().uuid()

const planSchema = z.object({
  clientId: uuid,
  // Optional: a retainer can exist without a site we built — an
  // inherited site still needs maintaining, and refusing that would
  // turn away revenue the schema is happy to hold.
  websiteProjectId: uuid
    .optional()
    .or(z.literal('').transform(() => undefined))
    .optional(),
  name: z.string().trim().min(1).max(300),
  monthlyAmount: z.coerce.number().finite().min(0),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, 'Currency must be a three-letter code')
    .default('EUR'),
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
      resourceType: 'maintenance_plan',
      resourceId,
      ...(metadata ? { metadata } : {}),
    })
  )
}

function field(data: FormData, name: string): string {
  const value = data.get(name)
  return typeof value === 'string' ? value : ''
}

export async function createMaintenancePlan(
  _prev: MaintenanceState,
  formData: FormData
): Promise<MaintenanceState> {
  const auth = await getAuthContext()
  if (!auth?.hasMembership || !auth.organizationId) return { error: 'No active membership.' }

  const parsed = planSchema.safeParse({
    clientId: field(formData, 'clientId'),
    websiteProjectId: field(formData, 'websiteProjectId'),
    name: field(formData, 'name'),
    monthlyAmount: field(formData, 'monthlyAmount') || '0',
    currency: field(formData, 'currency') || 'EUR',
  })
  if (!parsed.success) {
    return { error: 'Choose a client, give the plan a name, and set a monthly amount.' }
  }

  const supabase = await createUserClient()

  // Business scope comes from the client row the database returned, never
  // from the form — a caller must not be able to file a plan against a
  // business they cannot see.
  const { data: client, error: clientError } = await supabase
    .from('clients')
    .select('id, business_id, company_name')
    .eq('id', parsed.data.clientId)
    .single()
  if (clientError || !client) return { error: 'Could not load that client (check your access).' }

  // A linked project must belong to the same client. Without this check a
  // plan could point at another client's site, and the first anyone would
  // notice is a support request answered against the wrong website.
  if (parsed.data.websiteProjectId) {
    const { data: project, error: projectError } = await supabase
      .from('website_projects')
      .select('id, client_id')
      .eq('id', parsed.data.websiteProjectId)
      .single()
    if (projectError || !project) return { error: 'Could not load that website project.' }
    if (project.client_id !== client.id) {
      return { error: 'That website project belongs to a different client.' }
    }
  }

  const { data, error } = await supabase
    .from('maintenance_plans')
    .insert({
      organization_id: auth.organizationId,
      business_id: client.business_id,
      client_id: client.id,
      website_project_id: parsed.data.websiteProjectId ?? null,
      name: parsed.data.name,
      monthly_amount: parsed.data.monthlyAmount,
      currency: parsed.data.currency,
      status: 'active',
    })
    .select('id')
    .single()

  if (error || !data) return { error: 'Could not save the plan (check your access).' }

  // Amount and currency are commercial terms, not identity data, so they
  // are safe in the audit trail — and they are the fields anyone
  // reconstructing a revenue dispute will need.
  await audit('maintenance_plan.created', data.id, client.business_id, {
    currency: parsed.data.currency,
    monthly_amount: parsed.data.monthlyAmount.toFixed(2),
  })

  revalidatePath('/maintenance')
  revalidatePath('/clients')
  return { error: null, ok: true }
}

/**
 * Moves a plan through its lifecycle.
 *
 * `cancelled` is terminal. A cancelled retainer that can be silently
 * reactivated makes churn unmeasurable — the number would drift down
 * every time someone corrected a mistake, and nobody could tell a
 * correction from a win. Restarting means a new plan, which is also
 * what actually happened commercially.
 */
export async function updateMaintenanceStatus(
  planId: string,
  status: string
): Promise<MaintenanceState> {
  const auth = await getAuthContext()
  if (!auth?.hasMembership) return { error: 'No active membership.' }
  if (!uuid.safeParse(planId).success) return { error: 'Unknown plan.' }
  if (!MAINTENANCE_STATUSES.includes(status as MaintenanceStatus)) {
    return { error: 'Unknown status.' }
  }

  const supabase = await createUserClient()
  const { data: existing, error: readError } = await supabase
    .from('maintenance_plans')
    .select('id, business_id, status')
    .eq('id', planId)
    .single()
  if (readError || !existing) return { error: 'Could not load that plan (check your access).' }

  if (existing.status === 'cancelled') {
    return { error: 'That plan is cancelled. Create a new plan to restart the relationship.' }
  }
  if (existing.status === status) return { error: `That plan is already ${status}.` }

  const { error } = await supabase.from('maintenance_plans').update({ status }).eq('id', planId)
  if (error) return { error: 'Could not update the plan.' }

  await audit('maintenance_plan.status_changed', planId, existing.business_id, {
    from: existing.status,
    to: status,
  })

  revalidatePath('/maintenance')
  return { error: null, ok: true }
}
