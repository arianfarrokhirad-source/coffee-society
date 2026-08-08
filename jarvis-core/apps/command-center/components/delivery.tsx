'use client'

import { useActionState, useState, useTransition } from 'react'
import {
  createWebsiteProject,
  recordDeployment,
  requestDeployment,
  updateProjectStage,
  type DeliveryState,
} from '@/app/actions/delivery'

const initial: DeliveryState = { error: null }

export function ProjectForm({
  proposals,
}: {
  proposals: { id: string; title: string; leads: { company_name: string } | null }[]
}) {
  const [state, action, pending] = useActionState(createWebsiteProject, initial)

  if (proposals.length === 0) {
    return (
      <p className="text-sm text-muted">
        Delivery starts from an accepted proposal. Accept one on the Proposals page first.
      </p>
    )
  }

  return (
    <form action={action} className="space-y-3">
      <div>
        <label htmlFor="proposalId">Accepted proposal</label>
        <select id="proposalId" name="proposalId" required className="mt-1 w-full">
          {proposals.map((p) => (
            <option key={p.id} value={p.id}>
              {p.leads?.company_name ? `${p.leads.company_name} — ` : ''}
              {p.title}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="name">Project name</label>
        <input
          id="name"
          name="name"
          required
          maxLength={300}
          placeholder="Acme Joinery website"
          className="mt-1 w-full"
        />
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      <button className="btn w-full" disabled={pending}>
        {pending ? 'Creating…' : 'Start delivery'}
      </button>
    </form>
  )
}

const STAGE_NEXT: Record<string, { label: string; status: string }[]> = {
  planning: [{ label: 'Design', status: 'design' }],
  design: [{ label: 'Build', status: 'build' }],
  build: [{ label: 'Review', status: 'review' }],
  review: [{ label: 'Back to build', status: 'build' }],
  deployed: [{ label: 'Close', status: 'closed' }],
}

export function ProjectActions({
  projectId,
  status,
  hasApprovedGoLive,
}: {
  projectId: string
  status: string
  hasApprovedGoLive: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [asking, setAsking] = useState(false)

  const moves = STAGE_NEXT[status] ?? []
  // Go-live is offered from review onward — the point at which the site
  // is actually ready for a client to see.
  const canRequest = status === 'review' && !hasApprovedGoLive
  const canRecord = hasApprovedGoLive && status !== 'deployed'

  return (
    <div className="space-y-1">
      <span className="flex flex-wrap gap-1">
        {moves.map((move) => (
          <button
            key={move.status}
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await updateProjectStage(projectId, move.status)
                setMessage(result.error)
              })
            }
            className="rounded border border-edge px-2 py-0.5 text-xs text-gray-300 hover:border-accent hover:text-white disabled:opacity-50"
          >
            {move.label}
          </button>
        ))}

        {canRequest && (
          <button
            disabled={pending}
            onClick={() => setAsking((open) => !open)}
            className="rounded border border-warn px-2 py-0.5 text-xs text-warn hover:bg-warn/10 disabled:opacity-50"
          >
            Request go-live
          </button>
        )}

        {canRecord && (
          <button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await recordDeployment(projectId)
                setMessage(result.error ?? result.notice ?? null)
              })
            }
            className="rounded border border-accent px-2 py-0.5 text-xs text-white hover:bg-accent/20 disabled:opacity-50"
          >
            Mark live
          </button>
        )}
      </span>

      {asking && (
        <span className="flex gap-1">
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://acme.example"
            aria-label="Live site URL"
            className="w-56 text-xs"
          />
          <button
            disabled={pending || url.trim() === ''}
            onClick={() =>
              startTransition(async () => {
                const result = await requestDeployment(projectId, url)
                setMessage(result.error ?? result.notice ?? null)
                if (!result.error) setAsking(false)
              })
            }
            className="rounded border border-warn px-2 py-0.5 text-xs text-warn disabled:opacity-50"
          >
            Send for approval
          </button>
        </span>
      )}

      {message && <p className="text-xs text-muted">{message}</p>}
    </div>
  )
}
