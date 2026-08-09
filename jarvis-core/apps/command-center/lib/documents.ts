// Document constants.
//
// Not in app/actions/documents.ts: a 'use server' module may only export
// async functions, so a constant exported from there breaks the
// production build while Vitest passes happily.

/** public.document_classification, mirrored so the UI cannot drift. */
export const DOCUMENT_CLASSIFICATIONS = [
  'public',
  'internal',
  'confidential',
  'restricted',
] as const

export type DocumentClassification = (typeof DOCUMENT_CLASSIFICATIONS)[number]

/** public.document_approval_status. */
export const DOCUMENT_APPROVAL_STATUSES = [
  'draft',
  'pending_review',
  'approved',
  'archived',
] as const

export type DocumentApprovalStatus = (typeof DOCUMENT_APPROVAL_STATUSES)[number]

/**
 * Existing policy: L2, internal, risk medium, no approval required.
 *
 * Documents carry an `approval_status` column, which reads like it
 * implies an approval workflow. It does not: that column is the
 * document's own editorial lifecycle (is this draft or signed off?),
 * while ACTION_POLICIES governs whether an ACTION needs a human gate.
 * `document.write` is not `alwaysApproval`, so no gate is raised here —
 * inventing one would contradict the policy registry.
 */
export const DOCUMENT_WRITE_ACTION = 'document.write'

/**
 * True when a version has a file behind it.
 *
 * `storage_path` is nullable and blob upload is not wired yet, so a
 * version is frequently metadata plus a change note and nothing else.
 * Callers must ask rather than assume — offering a download that 404s
 * is worse than saying plainly that no file is attached.
 */
export function hasStoredFile(storagePath: string | null | undefined): boolean {
  return typeof storagePath === 'string' && storagePath.trim() !== ''
}
