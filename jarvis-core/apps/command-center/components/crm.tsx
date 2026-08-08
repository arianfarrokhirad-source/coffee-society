'use client'

import { useActionState, useTransition } from 'react'
import { convertLeadToClient, createLead, updateLeadStatus, type CrmState } from '@/app/actions/crm'

const initial: CrmState = { error: null }

export function LeadForm({
  businesses,
}: {
  businesses: { id: string; code: string; name: string }[]
}) {
  const [state, action, pending] = useActionState(createLead, initial)

  return (
    <form action={action} className="space-y-3">
      <div>
        <label htmlFor="companyName">Company</label>
        <input
          id="companyName"
          name="companyName"
          required
          maxLength={200}
          placeholder="Acme Joinery Ltd"
          className="mt-1 w-full"
        />
      </div>

      <div>
        <label htmlFor="businessId">Business</label>
        <select id="businessId" name="businessId" required className="mt-1 w-full">
          {businesses.map((b) => (
            <option key={b.id} value={b.id}>
              {b.code} — {b.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="contactName">Contact</label>
          <input id="contactName" name="contactName" maxLength={200} className="mt-1 w-full" />
        </div>
        <div>
          <label htmlFor="source">Source</label>
          <input
            id="source"
            name="source"
            maxLength={100}
            placeholder="referral, walk-in…"
            className="mt-1 w-full"
          />
        </div>
        <div>
          <label htmlFor="contactEmail">Email</label>
          <input id="contactEmail" name="contactEmail" maxLength={200} className="mt-1 w-full" />
        </div>
        <div>
          <label htmlFor="contactPhone">Phone</label>
          <input id="contactPhone" name="contactPhone" maxLength={50} className="mt-1 w-full" />
        </div>
      </div>

      <div>
        <label htmlFor="websiteUrl">Current website</label>
        <input
          id="websiteUrl"
          name="websiteUrl"
          maxLength={500}
          placeholder="https://…"
          className="mt-1 w-full"
        />
      </div>

      <div>
        <label htmlFor="notes">Notes</label>
        <textarea id="notes" name="notes" rows={2} maxLength={5000} className="mt-1 w-full" />
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}

      <button className="btn w-full" disabled={pending}>
        {pending ? 'Adding…' : 'Add lead'}
      </button>
    </form>
  )
}

/**
 * Only the moves that make sense from each stage. Offering every status
 * everywhere is how a pipeline stops meaning anything — the point of a
 * stage is that it constrains what comes next.
 */
const NEXT: Record<string, { label: string; status: string }[]> = {
  new: [
    { label: 'Contacted', status: 'contacted' },
    { label: 'Lost', status: 'lost' },
  ],
  contacted: [
    { label: 'Qualified', status: 'qualified' },
    { label: 'Lost', status: 'lost' },
  ],
  qualified: [
    { label: 'Audit booked', status: 'audit_scheduled' },
    { label: 'Lost', status: 'lost' },
  ],
  audit_scheduled: [
    { label: 'Proposal sent', status: 'proposal_sent' },
    { label: 'Lost', status: 'lost' },
  ],
  proposal_sent: [{ label: 'Lost', status: 'lost' }],
  lost: [{ label: 'Reopen', status: 'contacted' }],
}

export function LeadActions({
  leadId,
  status,
  converted,
}: {
  leadId: string
  status: string
  converted: boolean
}) {
  const [pending, startTransition] = useTransition()
  const moves = NEXT[status] ?? []
  // Winning a lead means creating the client, so the two are one button
  // rather than a status change that leaves no client behind.
  const canConvert = !converted && (status === 'proposal_sent' || status === 'qualified')

  if (moves.length === 0 && !canConvert) return null

  return (
    <span className="flex flex-wrap gap-1">
      {canConvert && (
        <button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await convertLeadToClient(leadId)
            })
          }
          className="rounded border border-accent px-2 py-0.5 text-xs text-white hover:bg-accent/20 disabled:opacity-50"
        >
          Won → client
        </button>
      )}
      {moves.map((move) => (
        <button
          key={move.status}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await updateLeadStatus(leadId, move.status)
            })
          }
          className="rounded border border-edge px-2 py-0.5 text-xs text-gray-300 hover:border-accent hover:text-white disabled:opacity-50"
        >
          {move.label}
        </button>
      ))}
    </span>
  )
}
