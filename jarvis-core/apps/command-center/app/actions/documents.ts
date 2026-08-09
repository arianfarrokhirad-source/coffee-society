'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { buildAuditEvent } from '@jarvis/security'
import { getAuthContext } from '@/lib/auth'
import { DOCUMENT_CLASSIFICATIONS } from '@/lib/documents'
import { getStore } from '@/lib/jarvis'
import { createUserClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------
// Documents and their version history.
//
// Nothing new is modelled. 0005_documents.sql already had documents
// (owner, with a stored current_version) and document_versions
// (children, unique on document_id + version). The only schema change is
// migration 0012, which adds the INSERT policy that 0007 never granted —
// without it the history table was readable and permanently unwritable.
//
// Four facts from the schema shape everything below:
//
//   Version numbers are STORED, not derived. documents.current_version
//   is an integer column and document_versions.version is unique per
//   document. So the database, not this code, is the arbiter of what
//   already exists — a concurrent append loses to the unique index and
//   is reported, never silently overwritten.
//
//   document_versions has no updated_at and no update trigger, and now
//   deliberately has no UPDATE or DELETE policy. History is append-only
//   at the database level.
//
//   Files live in Supabase Storage and storage_path is NULLABLE. Upload
//   is not wired. A version is therefore often a change note with no
//   blob, and that is a legitimate state to record rather than a broken
//   one to hide.
//
//   Documents scope to organization and business. There is NO client_id
//   and NO project_id on documents, so "which client does this belong
//   to" is answerable only as far as business. Inventing a link column
//   would be inventing a model, so the UI says what it actually knows.
// ---------------------------------------------------------------------

export interface DocumentState {
  error: string | null
  ok?: boolean
  /** Set on a successful append so the UI can confirm what landed. */
  version?: number
}

const uuid = z.string().uuid()

/** Trims to undefined, so an untouched field stores NULL, not ''. */
function optionalText(max: number) {
  return z
    .string()
    .max(max)
    .transform((value) => (value.trim() === '' ? undefined : value.trim()))
    .optional()
}

const documentSchema = z.object({
  title: z.string().trim().min(1).max(300),
  // Nullable in the schema: an organisation-wide document belongs to no
  // single business, and can_access_scoped() handles that case.
  businessId: uuid.optional().or(z.literal('').transform(() => undefined)),
  classification: z.enum(DOCUMENT_CLASSIFICATIONS).default('internal'),
  changeNote: optionalText(2000),
  storagePath: optionalText(500),
})

const versionSchema = z.object({
  documentId: uuid,
  changeNote: optionalText(2000),
  storagePath: optionalText(500),
  sizeBytes: z.coerce.number().int().min(0).optional(),
})

async function audit(
  action: string,
  resourceId: string | null,
  businessId: string | null,
  metadata?: Record<string, string>
) {
  const auth = await getAuthContext()
  await getStore().writeAudit(
    buildAuditEvent({
      organizationId: auth?.organizationId ?? null,
      businessId,
      actorType: 'user',
      actorId: auth?.userId ?? null,
      action,
      resourceType: 'document',
      resourceId,
      ...(metadata ? { metadata } : {}),
    })
  )
}

function field(data: FormData, name: string): string {
  const value = data.get(name)
  return typeof value === 'string' ? value : ''
}

/**
 * Creates a document and its first version together.
 *
 * The document row is written first because the version row references
 * it. If the version insert then fails, the document exists at
 * current_version 1 with no version row — visibly incomplete, and
 * repairable by appending. The opposite ordering is impossible (the
 * foreign key forbids it) and the opposite failure would be worse: a
 * history entry pointing at nothing.
 */
export async function createDocument(
  _prev: DocumentState,
  formData: FormData
): Promise<DocumentState> {
  const auth = await getAuthContext()
  if (!auth?.hasMembership || !auth.organizationId) return { error: 'No active membership.' }

  const parsed = documentSchema.safeParse({
    title: field(formData, 'title'),
    businessId: field(formData, 'businessId'),
    classification: field(formData, 'classification') || 'internal',
    changeNote: field(formData, 'changeNote'),
    storagePath: field(formData, 'storagePath'),
  })
  if (!parsed.success) return { error: 'Give the document a title and a classification.' }

  const supabase = await createUserClient()

  const { data: document, error } = await supabase
    .from('documents')
    .insert({
      organization_id: auth.organizationId,
      business_id: parsed.data.businessId ?? null,
      title: parsed.data.title,
      classification: parsed.data.classification,
      approval_status: 'draft',
      storage_bucket: 'documents',
      storage_path: parsed.data.storagePath ?? null,
      current_version: 1,
      status: 'active',
      owner_id: auth.userId,
      created_by: auth.userId,
      // Only claim an upload happened when a path was actually given.
      uploaded_at: parsed.data.storagePath ? new Date().toISOString() : null,
    })
    .select('id, business_id')
    .single()

  if (error || !document) return { error: 'Could not save the document (check your access).' }

  const { error: versionError } = await supabase.from('document_versions').insert({
    document_id: document.id,
    version: 1,
    storage_path: parsed.data.storagePath ?? null,
    change_note: parsed.data.changeNote ?? 'Initial version',
    created_by: auth.userId,
  })

  await audit('document.created', document.id, document.business_id, {
    classification: parsed.data.classification,
  })

  revalidatePath('/knowledge')

  if (versionError) {
    // Reported rather than swallowed: the document is real, its history
    // is not, and only the person who just clicked can decide whether to
    // retry or carry on.
    return {
      error: 'Document saved, but its first version was not recorded. Add a version to repair it.',
    }
  }

  return { error: null, ok: true, version: 1 }
}

/**
 * Appends a new version.
 *
 * The next number is taken from the highest version that actually
 * exists, reconciled with the document's stored current_version. Using
 * either alone is fragile: current_version can drift ahead if a previous
 * append half-completed, and max(version) can lag if a row was never
 * written. Taking the greater of the two self-heals in both directions,
 * and the unique index remains the final arbiter.
 */
export async function addDocumentVersion(
  _prev: DocumentState,
  formData: FormData
): Promise<DocumentState> {
  const auth = await getAuthContext()
  if (!auth?.hasMembership) return { error: 'No active membership.' }

  const parsed = versionSchema.safeParse({
    documentId: field(formData, 'documentId'),
    changeNote: field(formData, 'changeNote'),
    storagePath: field(formData, 'storagePath'),
    sizeBytes: field(formData, 'sizeBytes') || undefined,
  })
  if (!parsed.success) return { error: 'Choose a document and describe what changed.' }

  // A version with no note and no file records nothing a reader could
  // use — "what changed?" would answer with silence.
  if (!parsed.data.changeNote && !parsed.data.storagePath) {
    return { error: 'Describe what changed, or attach a file path.' }
  }

  const supabase = await createUserClient()

  // Scope comes from the document row the database returned. The browser
  // supplies only the document id; business and organisation are never
  // taken from the form.
  const { data: document, error: readError } = await supabase
    .from('documents')
    .select('id, business_id, current_version, status')
    .eq('id', parsed.data.documentId)
    .single()
  if (readError || !document) {
    return { error: 'Could not load that document (check your access).' }
  }
  if (document.status !== 'active') {
    return { error: `That document is ${String(document.status)} and cannot take new versions.` }
  }

  const { data: latest } = await supabase
    .from('document_versions')
    .select('version')
    .eq('document_id', document.id)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  const highest = Math.max(Number(document.current_version) || 0, Number(latest?.version) || 0)
  const next = highest + 1

  const { error: insertError } = await supabase.from('document_versions').insert({
    document_id: document.id,
    version: next,
    storage_path: parsed.data.storagePath ?? null,
    size_bytes: parsed.data.sizeBytes ?? null,
    change_note: parsed.data.changeNote ?? null,
    created_by: auth.userId,
  })

  if (insertError) {
    // 23505 is the unique index on (document_id, version) — someone else
    // appended between our read and our write. Their version stands;
    // ours is refused rather than overwriting theirs.
    const conflict = String((insertError as { code?: string }).code) === '23505'
    return {
      error: conflict
        ? 'Someone else added a version just now. Reload to see it, then try again.'
        : 'Could not record the version (check your access).',
    }
  }

  // The pointer is bumped only after the history row is safely written.
  // The reverse order would leave a document claiming a version that
  // does not exist, which is a lie the UI would repeat.
  const { error: bumpError } = await supabase
    .from('documents')
    .update({
      current_version: next,
      ...(parsed.data.storagePath
        ? { storage_path: parsed.data.storagePath, uploaded_at: new Date().toISOString() }
        : {}),
      ...(parsed.data.sizeBytes != null ? { size_bytes: parsed.data.sizeBytes } : {}),
    })
    .eq('id', document.id)

  await audit('document.version_added', document.id, document.business_id, {
    version: String(next),
  })

  revalidatePath('/knowledge')
  revalidatePath(`/knowledge/${document.id}`)

  if (bumpError) {
    // The history is correct and the pointer is stale. Said plainly,
    // because the next append self-heals it and a silent success would
    // leave the current-version badge quietly wrong.
    return {
      error: `Version ${next} was recorded, but the document still shows v${String(document.current_version)}. The next version will correct it.`,
    }
  }

  return { error: null, ok: true, version: next }
}

/**
 * Archives or restores a document.
 *
 * Reuses the existing `status` column rather than deleting: RLS reserves
 * DELETE for PRIME, and a deleted deliverable takes its history with it
 * through the cascade.
 */
export async function setDocumentStatus(
  documentId: string,
  status: string
): Promise<DocumentState> {
  const auth = await getAuthContext()
  if (!auth?.hasMembership) return { error: 'No active membership.' }
  if (!uuid.safeParse(documentId).success) return { error: 'Unknown document.' }
  if (status !== 'active' && status !== 'archived') return { error: 'Unknown status.' }

  const supabase = await createUserClient()
  const { data: existing, error: readError } = await supabase
    .from('documents')
    .select('id, business_id, status')
    .eq('id', documentId)
    .single()
  if (readError || !existing) return { error: 'Could not load that document.' }
  if (existing.status === status) return { error: `That document is already ${status}.` }

  const { error } = await supabase.from('documents').update({ status }).eq('id', documentId)
  if (error) return { error: 'Could not update the document.' }

  await audit('document.status_changed', documentId, existing.business_id, {
    from: String(existing.status),
    to: status,
  })

  revalidatePath('/knowledge')
  return { error: null, ok: true }
}
