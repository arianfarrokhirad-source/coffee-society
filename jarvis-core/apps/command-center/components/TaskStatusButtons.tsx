'use client'

import { useTransition } from 'react'
import { updateTaskStatus } from '@/app/actions/work'

const NEXT: Record<string, { label: string; status: string }[]> = {
  todo: [
    { label: 'Start', status: 'in_progress' },
    { label: 'Cancel', status: 'cancelled' },
  ],
  in_progress: [
    { label: 'Done', status: 'done' },
    { label: 'Block', status: 'blocked' },
  ],
  blocked: [{ label: 'Unblock', status: 'in_progress' }],
  review: [{ label: 'Done', status: 'done' }],
}

export default function TaskStatusButtons({ taskId, status }: { taskId: string; status: string }) {
  const [pending, startTransition] = useTransition()
  const actions = NEXT[status] ?? []
  if (actions.length === 0) return null
  return (
    <span className="flex gap-1">
      {actions.map((a) => (
        <button
          key={a.status}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await updateTaskStatus(taskId, a.status)
            })
          }
          className="rounded border border-edge px-2 py-0.5 text-xs text-gray-300 hover:border-accent hover:text-white disabled:opacity-50"
        >
          {a.label}
        </button>
      ))}
    </span>
  )
}
