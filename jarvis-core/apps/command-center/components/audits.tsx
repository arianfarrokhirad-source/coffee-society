'use client'

import { useActionState, useTransition } from 'react'
import { RISK_LEVELS } from '@jarvis/shared'
import { completeAudit, createAudit, type AuditState } from '@/app/actions/audits'

const initial: AuditState = { error: null }
const FINDING_SLOTS = [0, 1, 2, 3, 4]

export function AuditForm({
  leads,
}: {
  leads: { id: string; company_name: string; website_url: string | null }[]
}) {
  const [state, action, pending] = useActionState(createAudit, initial)

  if (leads.length === 0) {
    return (
      <p className="text-sm text-muted">
        An audit is recorded against a lead. Add one on the Clients page first.
      </p>
    )
  }

  return (
    <form action={action} className="space-y-3">
      <div>
        <label htmlFor="leadId">Lead</label>
        <select id="leadId" name="leadId" required className="mt-1 w-full">
          {leads.map((lead) => (
            <option key={lead.id} value={lead.id}>
              {lead.company_name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="websiteUrl">Site audited</label>
        <input
          id="websiteUrl"
          name="websiteUrl"
          maxLength={500}
          placeholder="Leave blank to use the lead's website"
          className="mt-1 w-full"
        />
      </div>

      <div>
        <label htmlFor="score">Score (0–100)</label>
        <input
          id="score"
          name="score"
          type="number"
          min="0"
          max="100"
          placeholder="42"
          className="mt-1 w-full"
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-xs uppercase tracking-wider text-muted">Findings</legend>
        {FINDING_SLOTS.map((slot) => (
          <div key={slot} className="grid grid-cols-[7rem_1fr_6rem] gap-2">
            <input
              name={`finding_${slot}_area`}
              maxLength={120}
              placeholder="Speed"
              aria-label={`Finding ${slot + 1} area`}
            />
            <input
              name={`finding_${slot}_issue`}
              maxLength={500}
              placeholder={slot === 0 ? 'Loads in 8s on mobile' : 'Add another…'}
              aria-label={`Finding ${slot + 1} issue`}
            />
            <select
              name={`finding_${slot}_severity`}
              defaultValue="medium"
              aria-label={`Finding ${slot + 1} severity`}
            >
              {RISK_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </div>
        ))}
      </fieldset>

      <div>
        <label htmlFor="summary">Summary</label>
        <textarea id="summary" name="summary" rows={2} maxLength={5000} className="mt-1 w-full" />
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}

      <button className="btn w-full" disabled={pending}>
        {pending ? 'Saving…' : 'Save audit'}
      </button>
    </form>
  )
}

export function AuditActions({ auditId, status }: { auditId: string; status: string }) {
  const [pending, startTransition] = useTransition()
  // Completion is one-way: an audit is evidence a client was shown.
  if (status === 'completed') return null

  return (
    <button
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await completeAudit(auditId)
        })
      }
      className="rounded border border-accent px-2 py-0.5 text-xs text-white hover:bg-accent/20 disabled:opacity-50"
    >
      Complete
    </button>
  )
}
