'use client'

import { useState, useTransition } from 'react'
import { resolveApproval } from '@/app/actions/approvals'

export default function ApprovalActions({ approvalId }: { approvalId: string }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const resolve = (resolution: 'approved' | 'rejected' | 'cancelled') =>
    startTransition(async () => {
      const result = await resolveApproval(approvalId, resolution)
      setError(result.error)
    })

  return (
    <div className="flex items-center gap-2">
      <button className="btn" disabled={pending} onClick={() => resolve('approved')}>
        Approve
      </button>
      <button className="btn-danger" disabled={pending} onClick={() => resolve('rejected')}>
        Reject
      </button>
      <button className="btn-ghost" disabled={pending} onClick={() => resolve('cancelled')}>
        Cancel
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  )
}
