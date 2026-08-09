'use client'

import { useActionState, useTransition } from 'react'
import {
  addDocumentVersion,
  createDocument,
  setDocumentStatus,
  type DocumentState,
} from '@/app/actions/documents'
import { DOCUMENT_CLASSIFICATIONS } from '@/lib/documents'

const initial: DocumentState = { error: null }

export function DocumentForm({ businesses }: { businesses: { id: string; code: string }[] }) {
  const [state, action, pending] = useActionState(createDocument, initial)

  return (
    <form action={action} className="space-y-3">
      <div>
        <label htmlFor="title">Title</label>
        <input
          id="title"
          name="title"
          required
          maxLength={300}
          placeholder="Acme Joinery — brand guidelines"
          className="mt-1 w-full"
        />
      </div>

      <div>
        <label htmlFor="businessId">Business</label>
        <select id="businessId" name="businessId" className="mt-1 w-full">
          {/* business_id is nullable: an organisation-wide document
              belongs to no single business. */}
          <option value="">Organisation-wide</option>
          {businesses.map((business) => (
            <option key={business.id} value={business.id}>
              {business.code}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="classification">Classification</label>
        <select
          id="classification"
          name="classification"
          defaultValue="internal"
          className="mt-1 w-full"
        >
          {DOCUMENT_CLASSIFICATIONS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-muted">Restricted documents are visible to PRIME only.</p>
      </div>

      <div>
        <label htmlFor="storagePath">Storage path (optional)</label>
        <input
          id="storagePath"
          name="storagePath"
          maxLength={500}
          placeholder="acme/brand-guidelines-v1.pdf"
          className="mt-1 w-full"
        />
        {/* Upload is not wired yet. Saying so beats a file picker that
            silently does nothing. */}
        <p className="mt-1 text-xs text-muted">
          File upload is not wired yet — record the path if the file already exists in the documents
          bucket.
        </p>
      </div>

      <div>
        <label htmlFor="changeNote">What is this?</label>
        <textarea
          id="changeNote"
          name="changeNote"
          rows={2}
          maxLength={2000}
          placeholder="Initial version"
          className="mt-1 w-full"
        />
      </div>

      {state.error && <p className="text-sm text-danger">{state.error}</p>}

      <button className="btn" disabled={pending}>
        {pending ? 'Saving…' : 'Add document'}
      </button>
    </form>
  )
}

export function VersionForm({ documentId }: { documentId: string }) {
  const [state, action, pending] = useActionState(addDocumentVersion, initial)

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="documentId" value={documentId} />

      <div>
        <label htmlFor="changeNote">What changed?</label>
        <textarea
          id="changeNote"
          name="changeNote"
          rows={3}
          maxLength={2000}
          placeholder="Updated the colour palette and swapped the logo lockup"
          className="mt-1 w-full"
        />
      </div>

      <div>
        <label htmlFor="storagePath">Storage path (optional)</label>
        <input
          id="storagePath"
          name="storagePath"
          maxLength={500}
          placeholder="acme/brand-guidelines-v2.pdf"
          className="mt-1 w-full"
        />
      </div>

      <div>
        <label htmlFor="sizeBytes">Size in bytes (optional)</label>
        <input id="sizeBytes" name="sizeBytes" type="number" min="0" className="mt-1 w-full" />
      </div>

      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      {state.ok && state.version != null && (
        <p className="text-sm text-muted">Recorded as v{state.version}.</p>
      )}

      <button className="btn" disabled={pending}>
        {pending ? 'Recording…' : 'Add version'}
      </button>
    </form>
  )
}

export function DocumentActions({ documentId, status }: { documentId: string; status: string }) {
  const [pending, start] = useTransition()
  const next = status === 'archived' ? 'active' : 'archived'

  // Deleted documents are terminal here: RLS reserves DELETE for PRIME,
  // and restoring one is not a decision this control should imply.
  if (status === 'deleted') return null

  return (
    <button
      className="btn-ghost"
      disabled={pending}
      onClick={() => start(() => void setDocumentStatus(documentId, next))}
    >
      {status === 'archived' ? 'Restore' : 'Archive'}
    </button>
  )
}
