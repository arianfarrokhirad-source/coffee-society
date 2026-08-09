import { beforeEach, describe, expect, it, vi } from 'vitest'

// Version history is only worth having if it is trustworthy. The
// invariants pinned here are the ones whose violation would make the
// history quietly wrong rather than obviously broken: versions never
// cross a document boundary, scope never comes from the browser,
// appends never overwrite, and a half-completed append is reported
// instead of being presented as success.

const writeAudit = vi.fn()
const revalidatePath = vi.fn()

let auth: { hasMembership: boolean; organizationId: string | null; userId: string | null } | null =
  null
let ops: string[] = []
let insertedDocument: Record<string, unknown> | null = null
let insertedVersion: Record<string, unknown> | null = null
let updatedDocument: Record<string, unknown> | null = null
let documentRow: Record<string, unknown> | null = null
let latestVersionRow: { version: number } | null = null
let documentInsertFails = false
let versionInsertError: { code?: string; message: string } | null = null
let bumpFails = false

function table(name: string) {
  return {
    insert: (values: Record<string, unknown>) => {
      ops.push(`insert:${name}`)
      if (name === 'documents') {
        insertedDocument = values
        return {
          select: () => ({
            single: async () => ({
              data: documentInsertFails ? null : { id: 'doc-1', business_id: 'biz-1' },
              error: documentInsertFails ? { message: 'denied' } : null,
            }),
          }),
        }
      }
      insertedVersion = values
      // document_versions insert is awaited directly, with no .select().
      return {
        then: (resolve: (v: { error: unknown }) => unknown) =>
          resolve({ error: versionInsertError }),
      }
    },
    update: (patch: Record<string, unknown>) => {
      ops.push(`update:${name}`)
      updatedDocument = patch
      return {
        eq: () => ({
          then: (resolve: (v: { error: unknown }) => unknown) =>
            resolve({ error: bumpFails ? { message: 'denied' } : null }),
        }),
      }
    },
    select: () => ({
      eq: () => ({
        single: async () => {
          ops.push(`select:${name}`)
          return { data: documentRow, error: documentRow ? null : { message: 'no' } }
        },
        order: () => ({
          limit: () => ({
            maybeSingle: async () => {
              ops.push(`select:${name}:latest`)
              return { data: latestVersionRow, error: null }
            },
          }),
        }),
      }),
    }),
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createUserClient: async () => ({ from: (n: string) => table(n) }),
}))
vi.mock('@/lib/auth', () => ({ getAuthContext: async () => auth }))
vi.mock('@/lib/jarvis', () => ({ getStore: () => ({ writeAudit }) }))
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidatePath(p) }))

const { addDocumentVersion, createDocument, setDocumentStatus } =
  await import('@/app/actions/documents')

const DOC_ID = '44444444-4444-4444-8444-444444444444'
const BUSINESS_ID = '55555555-5555-4555-8555-555555555555'

function documentForm(overrides: Record<string, string> = {}): FormData {
  const data = new FormData()
  const fields: Record<string, string> = {
    title: 'Acme Joinery — brand guidelines',
    businessId: BUSINESS_ID,
    classification: 'internal',
    changeNote: '',
    storagePath: '',
    ...overrides,
  }
  for (const [k, v] of Object.entries(fields)) data.set(k, v)
  return data
}

function versionForm(overrides: Record<string, string> = {}): FormData {
  const data = new FormData()
  const fields: Record<string, string> = {
    documentId: DOC_ID,
    changeNote: 'Swapped the logo lockup',
    storagePath: '',
    sizeBytes: '',
    ...overrides,
  }
  for (const [k, v] of Object.entries(fields)) data.set(k, v)
  return data
}

beforeEach(() => {
  ops = []
  insertedDocument = null
  insertedVersion = null
  updatedDocument = null
  documentRow = { id: DOC_ID, business_id: 'biz-1', current_version: 1, status: 'active' }
  latestVersionRow = { version: 1 }
  documentInsertFails = false
  versionInsertError = null
  bumpFails = false
  auth = { hasMembership: true, organizationId: 'org-1', userId: 'user-1' }
  writeAudit.mockReset()
  revalidatePath.mockReset()
})

describe('creating a document', () => {
  it('writes the document then its first version', async () => {
    const state = await createDocument({ error: null }, documentForm())
    expect(state.error).toBeNull()
    expect(state.version).toBe(1)

    // The document must exist before a version can reference it.
    const doc = ops.indexOf('insert:documents')
    const version = ops.indexOf('insert:document_versions')
    expect(doc).toBeGreaterThanOrEqual(0)
    expect(version).toBeGreaterThan(doc)
    expect(insertedDocument?.current_version).toBe(1)
    expect(insertedVersion?.version).toBe(1)
  })

  it('scopes to the organisation from the session, never the form', async () => {
    const form = documentForm()
    form.set('organizationId', 'org-attacker')
    await createDocument({ error: null }, form)
    expect(insertedDocument?.organization_id).toBe('org-1')
  })

  it('allows an organisation-wide document with no business', async () => {
    // business_id is nullable and can_access_scoped() handles it.
    await createDocument({ error: null }, documentForm({ businessId: '' }))
    expect(insertedDocument?.business_id).toBeNull()
  })

  it('does not claim an upload happened when no path was given', async () => {
    await createDocument({ error: null }, documentForm({ storagePath: '' }))
    expect(insertedDocument?.storage_path).toBeNull()
    expect(insertedDocument?.uploaded_at).toBeNull()
  })

  it('records an upload timestamp only when a path was given', async () => {
    await createDocument({ error: null }, documentForm({ storagePath: 'acme/brand-v1.pdf' }))
    expect(insertedDocument?.storage_path).toBe('acme/brand-v1.pdf')
    expect(insertedDocument?.uploaded_at).toBeTruthy()
  })

  it('defaults the first change note rather than storing nothing', async () => {
    await createDocument({ error: null }, documentForm({ changeNote: '' }))
    expect(insertedVersion?.change_note).toBe('Initial version')
  })

  it('rejects an unknown classification', async () => {
    const state = await createDocument({ error: null }, documentForm({ classification: 'secret' }))
    expect(state.error).toBeTruthy()
    expect(ops).not.toContain('insert:documents')
  })

  it('requires a title', async () => {
    const state = await createDocument({ error: null }, documentForm({ title: '  ' }))
    expect(state.error).toBeTruthy()
    expect(ops).not.toContain('insert:documents')
  })

  it('reports a document saved without its first version', async () => {
    // Silence here would leave a document whose history starts empty and
    // nobody would know why.
    versionInsertError = { message: 'denied' }
    const state = await createDocument({ error: null }, documentForm())
    expect(state.error).toMatch(/first version was not recorded/i)
  })

  it('does not attempt a version when the document could not be created', async () => {
    documentInsertFails = true
    const state = await createDocument({ error: null }, documentForm())
    expect(state.error).toMatch(/could not save/i)
    expect(ops).not.toContain('insert:document_versions')
  })

  it('refuses without a membership', async () => {
    auth = { hasMembership: false, organizationId: null, userId: null }
    const state = await createDocument({ error: null }, documentForm())
    expect(state.error).toBe('No active membership.')
    expect(ops).toEqual([])
  })
})

describe('appending a version', () => {
  it('records the next version and then moves the pointer', async () => {
    const state = await addDocumentVersion({ error: null }, versionForm())
    expect(state.error).toBeNull()
    expect(state.version).toBe(2)

    // History first, pointer second: the reverse would leave a document
    // claiming a version that does not exist.
    const insert = ops.indexOf('insert:document_versions')
    const bump = ops.indexOf('update:documents')
    expect(bump).toBeGreaterThan(insert)
    expect(insertedVersion?.version).toBe(2)
    expect(updatedDocument?.current_version).toBe(2)
  })

  it('takes the document id from the form but scope from the database', async () => {
    const form = versionForm()
    form.set('businessId', 'biz-attacker')
    await addDocumentVersion({ error: null }, form)
    // business_id never appears on the version row; it is derived from
    // the parent document by RLS.
    expect(insertedVersion?.document_id).toBe(DOC_ID)
    expect(insertedVersion).not.toHaveProperty('business_id')
  })

  it('never reuses a version number that already exists', async () => {
    documentRow = { id: DOC_ID, business_id: 'biz-1', current_version: 3, status: 'active' }
    latestVersionRow = { version: 3 }
    await addDocumentVersion({ error: null }, versionForm())
    expect(insertedVersion?.version).toBe(4)
  })

  it('self-heals when the pointer lags behind real history', async () => {
    // A previous append recorded v4 but failed to bump the pointer.
    documentRow = { id: DOC_ID, business_id: 'biz-1', current_version: 2, status: 'active' }
    latestVersionRow = { version: 4 }
    await addDocumentVersion({ error: null }, versionForm())
    expect(insertedVersion?.version).toBe(5)
  })

  it('self-heals when the pointer runs ahead of real history', async () => {
    documentRow = { id: DOC_ID, business_id: 'biz-1', current_version: 7, status: 'active' }
    latestVersionRow = { version: 2 }
    await addDocumentVersion({ error: null }, versionForm())
    expect(insertedVersion?.version).toBe(8)
  })

  it('starts at 1 when no history exists at all', async () => {
    documentRow = { id: DOC_ID, business_id: 'biz-1', current_version: 0, status: 'active' }
    latestVersionRow = null
    await addDocumentVersion({ error: null }, versionForm())
    expect(insertedVersion?.version).toBe(1)
  })

  it('refuses rather than overwriting when someone else appended first', async () => {
    // 23505 is the unique index on (document_id, version). Their version
    // stands; ours is refused.
    versionInsertError = { code: '23505', message: 'duplicate key' }
    const state = await addDocumentVersion({ error: null }, versionForm())
    expect(state.error).toMatch(/someone else added a version/i)
    expect(ops).not.toContain('update:documents')
  })

  it('does not move the pointer when the version could not be written', async () => {
    versionInsertError = { message: 'denied' }
    const state = await addDocumentVersion({ error: null }, versionForm())
    expect(state.error).toMatch(/could not record/i)
    expect(ops).not.toContain('update:documents')
  })

  it('reports a recorded version whose pointer did not move', async () => {
    // The history is right and the badge is stale. Claiming success
    // would leave the current-version badge quietly wrong.
    bumpFails = true
    const state = await addDocumentVersion({ error: null }, versionForm())
    expect(state.error).toMatch(/was recorded, but/i)
    expect(state.error).toMatch(/v1/)
  })

  it('requires a note or a file — silence records nothing useful', async () => {
    const state = await addDocumentVersion(
      { error: null },
      versionForm({ changeNote: '', storagePath: '' })
    )
    expect(state.error).toMatch(/describe what changed/i)
    expect(ops).toEqual([])
  })

  it('accepts a file path with no note', async () => {
    const state = await addDocumentVersion(
      { error: null },
      versionForm({ changeNote: '', storagePath: 'acme/brand-v2.pdf' })
    )
    expect(state.error).toBeNull()
    expect(insertedVersion?.storage_path).toBe('acme/brand-v2.pdf')
  })

  it('stores an absent file path as null, not an empty string', async () => {
    await addDocumentVersion({ error: null }, versionForm({ storagePath: '   ' }))
    expect(insertedVersion?.storage_path).toBeNull()
  })

  it('does not touch the document file fields when no path was given', async () => {
    // Otherwise adding a note-only version would blank the stored file.
    await addDocumentVersion({ error: null }, versionForm({ storagePath: '' }))
    expect(updatedDocument).not.toHaveProperty('storage_path')
    expect(updatedDocument?.current_version).toBe(2)
  })

  it('refuses to add a version to an archived document', async () => {
    documentRow = { id: DOC_ID, business_id: 'biz-1', current_version: 1, status: 'archived' }
    const state = await addDocumentVersion({ error: null }, versionForm())
    expect(state.error).toMatch(/archived/i)
    expect(ops).not.toContain('insert:document_versions')
  })

  it('refuses when the document is not visible under RLS', async () => {
    documentRow = null
    const state = await addDocumentVersion({ error: null }, versionForm())
    expect(state.error).toMatch(/could not load/i)
    expect(ops).not.toContain('insert:document_versions')
  })

  it('rejects a malformed document id before touching the database', async () => {
    const state = await addDocumentVersion({ error: null }, versionForm({ documentId: 'nope' }))
    expect(state.error).toBeTruthy()
    expect(ops).toEqual([])
  })

  it('records the version number in the audit trail', async () => {
    await addDocumentVersion({ error: null }, versionForm())
    const serialised = JSON.stringify(writeAudit.mock.calls)
    expect(serialised).toContain('document.version_added')
    expect(serialised).toContain('"version":"2"')
  })

  it('refuses without a membership', async () => {
    auth = { hasMembership: false, organizationId: null, userId: null }
    const state = await addDocumentVersion({ error: null }, versionForm())
    expect(state.error).toBe('No active membership.')
    expect(ops).toEqual([])
  })
})

describe('archiving a document', () => {
  it('archives an active document', async () => {
    const state = await setDocumentStatus(DOC_ID, 'archived')
    expect(state.error).toBeNull()
    expect(ops).toContain('update:documents')
  })

  it('restores an archived document', async () => {
    documentRow = { id: DOC_ID, business_id: 'biz-1', status: 'archived' }
    const state = await setDocumentStatus(DOC_ID, 'active')
    expect(state.error).toBeNull()
  })

  it('refuses a no-op transition', async () => {
    const state = await setDocumentStatus(DOC_ID, 'active')
    expect(state.error).toMatch(/already active/i)
  })

  it('refuses to set a status the action does not own', async () => {
    // 'deleted' exists in the schema but RLS reserves DELETE for PRIME;
    // this action must not become a back door to it.
    const state = await setDocumentStatus(DOC_ID, 'deleted')
    expect(state.error).toBe('Unknown status.')
    expect(ops).toEqual([])
  })

  it('rejects a malformed id before touching the database', async () => {
    const state = await setDocumentStatus('not-a-uuid', 'archived')
    expect(state.error).toBe('Unknown document.')
    expect(ops).toEqual([])
  })
})
