'use client'

import { useActionState, useTransition } from 'react'
import {
  createMaintenancePlan,
  updateMaintenanceStatus,
  type MaintenanceState,
} from '@/app/actions/maintenance'

const initial: MaintenanceState = { error: null }

export interface PlanClient {
  id: string
  company_name: string
}

export interface PlanProject {
  id: string
  name: string
  client_id: string | null
}

export function MaintenancePlanForm({
  clients,
  projects,
}: {
  clients: PlanClient[]
  projects: PlanProject[]
}) {
  const [state, action, pending] = useActionState(createMaintenancePlan, initial)

  if (clients.length === 0) {
    return (
      <p className="text-sm text-muted">
        A plan is billed to a client. Convert a won lead on the Clients page first.
      </p>
    )
  }

  return (
    <form action={action} className="space-y-3">
      <div>
        <label htmlFor="clientId">Client</label>
        <select id="clientId" name="clientId" required className="mt-1 w-full">
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.company_name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="name">Plan</label>
        <input
          id="name"
          name="name"
          required
          maxLength={300}
          placeholder="Hosting, updates and backups"
          className="mt-1 w-full"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="monthlyAmount">Monthly amount</label>
          <input
            id="monthlyAmount"
            name="monthlyAmount"
            type="number"
            min="0"
            step="0.01"
            required
            placeholder="400.00"
            className="mt-1 w-full"
          />
        </div>
        <div>
          <label htmlFor="currency">Currency</label>
          <input
            id="currency"
            name="currency"
            defaultValue="EUR"
            maxLength={3}
            pattern="[A-Za-z]{3}"
            className="mt-1 w-full uppercase"
          />
        </div>
      </div>

      <div>
        <label htmlFor="websiteProjectId">Website (optional)</label>
        <select id="websiteProjectId" name="websiteProjectId" className="mt-1 w-full">
          {/* A retainer can exist without a site we built — an inherited
              site still needs maintaining. */}
          <option value="">Not linked to a site we built</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </div>

      {state.error && <p className="text-sm text-danger">{state.error}</p>}

      <button className="btn" disabled={pending}>
        {pending ? 'Saving…' : 'Start plan'}
      </button>
    </form>
  )
}

export function MaintenanceActions({ planId, status }: { planId: string; status: string }) {
  const [pending, start] = useTransition()

  // Cancelled is terminal — no control is offered, because restarting is
  // a new plan rather than an edit to this one.
  if (status === 'cancelled') return null

  const move = (next: string) => start(() => void updateMaintenanceStatus(planId, next))

  return (
    <span className="flex gap-2">
      {status === 'active' && (
        <button className="btn-ghost" disabled={pending} onClick={() => move('paused')}>
          Pause
        </button>
      )}
      {status === 'paused' && (
        <button className="btn-ghost" disabled={pending} onClick={() => move('active')}>
          Resume
        </button>
      )}
      <button className="btn-ghost" disabled={pending} onClick={() => move('cancelled')}>
        Cancel
      </button>
    </span>
  )
}
