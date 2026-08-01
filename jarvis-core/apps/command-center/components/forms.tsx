'use client'

import { useActionState } from 'react'
import {
  createObjective,
  createProject,
  createTaskAction,
  recordDecisionAction,
  type ActionState,
} from '@/app/actions/work'

const initial: ActionState = { error: null }

export interface BusinessOption {
  id: string
  code: string
  name: string
}

function BusinessSelect({
  businesses,
  required,
}: {
  businesses: BusinessOption[]
  required?: boolean
}) {
  return (
    <div>
      <label htmlFor="businessId">Business{required ? '' : ' (optional)'}</label>
      <select
        id="businessId"
        name="businessId"
        required={required}
        className="mt-1 w-full"
        defaultValue=""
      >
        <option value="">{required ? 'Select a business…' : 'Organization-wide'}</option>
        {businesses.map((b) => (
          <option key={b.id} value={b.id}>
            {b.code} · {b.name}
          </option>
        ))}
      </select>
    </div>
  )
}

function PrioritySelect() {
  return (
    <div>
      <label htmlFor="priority">Priority</label>
      <select id="priority" name="priority" defaultValue="P2" className="mt-1 w-full">
        <option value="P0">P0 — Emergency</option>
        <option value="P1">P1 — Same day</option>
        <option value="P2">P2 — Operational</option>
        <option value="P3">P3 — Weekly</option>
      </select>
    </div>
  )
}

function FormShell({
  state,
  pending,
  submitLabel,
  children,
  action,
}: {
  state: ActionState
  pending: boolean
  submitLabel: string
  children: React.ReactNode
  action: (formData: FormData) => void
}) {
  return (
    <form action={action} className="space-y-3">
      {children}
      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      {state.ok && <p className="text-sm text-ok">Saved.</p>}
      <button className="btn" disabled={pending}>
        {pending ? 'Saving…' : submitLabel}
      </button>
    </form>
  )
}

export function ObjectiveForm({ businesses }: { businesses: BusinessOption[] }) {
  const [state, action, pending] = useActionState(createObjective, initial)
  return (
    <FormShell state={state} pending={pending} submitLabel="Create objective" action={action}>
      <div>
        <label htmlFor="obj-title">Title</label>
        <input id="obj-title" name="title" required maxLength={300} className="mt-1 w-full" />
      </div>
      <BusinessSelect businesses={businesses} />
      <PrioritySelect />
      <div>
        <label htmlFor="obj-target">Target date</label>
        <input id="obj-target" name="targetDate" type="date" className="mt-1 w-full" />
      </div>
    </FormShell>
  )
}

export function ProjectForm({ businesses }: { businesses: BusinessOption[] }) {
  const [state, action, pending] = useActionState(createProject, initial)
  return (
    <FormShell state={state} pending={pending} submitLabel="Create project" action={action}>
      <div>
        <label htmlFor="proj-name">Name</label>
        <input id="proj-name" name="name" required maxLength={300} className="mt-1 w-full" />
      </div>
      <BusinessSelect businesses={businesses} required />
      <PrioritySelect />
      <div>
        <label htmlFor="proj-due">Due date</label>
        <input id="proj-due" name="dueDate" type="date" className="mt-1 w-full" />
      </div>
    </FormShell>
  )
}

export function TaskForm({ businesses }: { businesses: BusinessOption[] }) {
  const [state, action, pending] = useActionState(createTaskAction, initial)
  return (
    <FormShell state={state} pending={pending} submitLabel="Create task" action={action}>
      <div>
        <label htmlFor="task-title">Title</label>
        <input id="task-title" name="title" required maxLength={300} className="mt-1 w-full" />
      </div>
      <BusinessSelect businesses={businesses} required />
      <PrioritySelect />
      <div>
        <label htmlFor="task-due">Due date</label>
        <input id="task-due" name="dueDate" type="date" className="mt-1 w-full" />
      </div>
    </FormShell>
  )
}

export function DecisionForm({ businesses }: { businesses: BusinessOption[] }) {
  const [state, action, pending] = useActionState(recordDecisionAction, initial)
  return (
    <FormShell state={state} pending={pending} submitLabel="Record decision" action={action}>
      <div>
        <label htmlFor="dec-title">Title</label>
        <input id="dec-title" name="title" required maxLength={300} className="mt-1 w-full" />
      </div>
      <div>
        <label htmlFor="dec-body">Decision</label>
        <textarea id="dec-body" name="decision" required rows={3} className="mt-1 w-full" />
      </div>
      <div>
        <label htmlFor="dec-rationale">Rationale</label>
        <textarea id="dec-rationale" name="rationale" rows={2} className="mt-1 w-full" />
      </div>
      <BusinessSelect businesses={businesses} />
    </FormShell>
  )
}
