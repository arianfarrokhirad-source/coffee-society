'use client'

import { useState, useTransition } from 'react'
import { resolveApproval } from '@/app/actions/approvals'

export default function ApprovalActions({
  approvalId,
  // The status this list was rendered with. Sent back so the database
  // can refuse the change if the approval moved in the meantime, rather
  // than silently overwriting a decision made from another tab.
  currentStatus = 'pending',
}: {
  approvalId: string
  currentStatus?: 'pending' | 'approved' | 'modified'
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const resolve = (resolution: 'approved' | 'rejected' | 'cancelled') =>
    startTransition(async () => {
      const result = await resolveApproval(approvalId, resolution, currentStatus)
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
