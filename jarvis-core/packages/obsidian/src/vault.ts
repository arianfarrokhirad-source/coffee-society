import { err, ok, type Result } from '@jarvis/shared'
import { composeNote, extractLinks, parseFrontmatter } from './frontmatter'
import { assertNoIdentityData, scanForIdentityData } from './guard'
import {
  DEFAULT_FOLDER,
  VAULT_FOLDERS,
  type Frontmatter,
  type Note,
  type NoteType,
  type VaultIssue,
} from './types'

// ---------------------------------------------------------------------
// The vault.
//
// Filesystem access is behind a port, for the same reason Graphify does
// it: the interesting logic is querying and validation, and neither
// should need a temp directory to test.
//
// Two rules from docs/OBSIDIAN.md are enforced here rather than left to
// discipline, because discipline is what fails:
//
//   Agent writes land in 00-inbox with status: unreviewed. If agents
//     write reviewed knowledge directly, the vault becomes a second
//     derived cache and its only advantage over Graphify — that a human
//     vouched for it — disappears.
//
//   Accepted ADRs are immutable. Changing your mind creates a new ADR
//     that supersedes the old one. Teams that edit accepted ADRs lose
//     the historical record within a year, and the record was the point.
// ---------------------------------------------------------------------

export interface VaultFs {
  /** Every markdown file, vault-relative, POSIX separators. */
  list(): Promise<string[]>
  read(path: string): Promise<string>
  write(path: string, contents: string): Promise<void>
  exists(path: string): Promise<boolean>
}

export interface Vault {
  notes(): Promise<Note[]>
  get(slug: string): Promise<Note | null>
  query(filter: NoteQuery): Promise<Note[]>
  search(text: string, filter?: NoteQuery): Promise<SearchHit[]>
  capture(input: CaptureInput): Promise<Result<{ path: string }>>
  promote(path: string): Promise<Result<{ path: string }>>
  validate(): Promise<VaultIssue[]>
  backlinks(slug: string): Promise<Note[]>
}

export interface NoteQuery {
  type?: NoteType | NoteType[]
  tags?: string[]
  status?: string | string[]
  business?: string
  /** Matches notes whose lastReviewed is older than this ISO date. */
  reviewedBefore?: string
}

export interface SearchHit {
  note: Note
  score: number
  /** Body excerpts around the match, for provenance in results. */
  excerpts: string[]
}

export interface CaptureInput {
  type: NoteType
  title: string
  body: string
  tags?: string[]
  business?: string
  /** Extra frontmatter. `status` is always forced to 'unreviewed'. */
  frontmatter?: Record<string, unknown>
}

/** Filesystem-safe slug that still reads as the title. */
export function slugify(title: string): string {
  return (
    title
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'untitled'
  )
}

function basenameSlug(path: string): string {
  const file = path.split('/').pop() ?? path
  return file.replace(/\.md$/i, '')
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

export function createVault(fs: VaultFs): Vault {
  async function notes(): Promise<Note[]> {
    const paths = await fs.list()
    const out: Note[] = []

    for (const path of paths) {
      let source: string
      try {
        source = await fs.read(path)
      } catch {
        // An unreadable note is reported by validate(), not thrown here.
        // One bad file must not make the whole vault unqueryable.
        continue
      }
      const { frontmatter, body } = parseFrontmatter(source)
      if (!frontmatter) continue
      out.push({
        path,
        frontmatter,
        body,
        links: extractLinks(body),
        slug: basenameSlug(path),
      })
    }

    return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  }

  function matches(note: Note, filter: NoteQuery): boolean {
    const types = asArray(filter.type)
    if (types.length > 0 && !types.includes(note.frontmatter.type)) return false

    const statuses = asArray(filter.status)
    if (statuses.length > 0) {
      const status = note.frontmatter.status
      if (typeof status !== 'string' || !statuses.includes(status)) return false
    }

    if (filter.business !== undefined && note.frontmatter.business !== filter.business) {
      return false
    }

    if (filter.tags && filter.tags.length > 0) {
      const noteTags = Array.isArray(note.frontmatter.tags) ? note.frontmatter.tags : []
      // Every requested tag must be present — an OR filter would widen
      // as the caller narrows, which is the opposite of what they asked.
      if (!filter.tags.every((tag) => noteTags.includes(tag))) return false
    }

    if (filter.reviewedBefore !== undefined) {
      const reviewed = note.frontmatter.lastReviewed
      // A note that has never been reviewed counts as overdue — that is
      // the whole point of asking.
      if (typeof reviewed !== 'string') return true
      if (reviewed >= filter.reviewedBefore) return false
    }

    return true
  }

  async function query(filter: NoteQuery): Promise<Note[]> {
    return (await notes()).filter((note) => matches(note, filter))
  }

  async function search(text: string, filter?: NoteQuery): Promise<SearchHit[]> {
    const terms = text
      .toLowerCase()
      .split(/\s+/)
      .filter((term) => term.length > 1)
    if (terms.length === 0) return []

    const candidates = filter ? await query(filter) : await notes()
    const hits: SearchHit[] = []

    for (const note of candidates) {
      const title = String(note.frontmatter.title ?? note.slug).toLowerCase()
      const id = String(note.frontmatter.id ?? '').toLowerCase()
      const haystack = note.body.toLowerCase()

      let score = 0
      const excerpts: string[] = []

      for (const term of terms) {
        // An exact id match is what makes "show me ADR-0001" work, and
        // it must outrank any amount of body text.
        if (id !== '' && id === term) score += 100
        if (title.includes(term)) score += 10
        const occurrences = haystack.split(term).length - 1
        if (occurrences > 0) {
          score += Math.min(occurrences, 5)
          const at = haystack.indexOf(term)
          excerpts.push(
            note.body
              .slice(Math.max(0, at - 60), at + 120)
              .replace(/\s+/g, ' ')
              .trim()
          )
        }
      }

      if (score > 0) hits.push({ note, score, excerpts: excerpts.slice(0, 3) })
    }

    return hits.sort((a, b) => b.score - a.score)
  }

  async function get(slug: string): Promise<Note | null> {
    const all = await notes()
    return (
      all.find((note) => note.slug === slug) ??
      all.find((note) => note.frontmatter.id === slug) ??
      null
    )
  }

  async function backlinks(slug: string): Promise<Note[]> {
    return (await notes()).filter((note) => note.links.includes(slug) && note.slug !== slug)
  }

  async function capture(input: CaptureInput): Promise<Result<{ path: string }>> {
    const title = input.title.trim()
    if (title === '') return err('A note needs a title.')

    const frontmatter: Frontmatter = {
      ...input.frontmatter,
      type: input.type,
      title,
      date: new Date().toISOString().slice(0, 10),
      // Forced, not defaulted. A caller cannot mark its own capture
      // reviewed — that is what makes review mean anything.
      status: 'unreviewed',
      ...(input.tags && input.tags.length > 0 ? { tags: input.tags } : {}),
      ...(input.business ? { business: input.business } : {}),
    }

    const contents = composeNote(frontmatter, input.body)

    try {
      // Both directions: nothing reaches disk unscanned.
      assertNoIdentityData(`${VAULT_FOLDERS.inbox}/${slugify(title)}.md`, contents)
    } catch (cause) {
      return err(cause instanceof Error ? cause.message : 'Identity-data check failed.')
    }

    // Agent captures always land in the inbox regardless of type. The
    // type decides where a human files it on promotion, not where an
    // unreviewed note appears.
    let path = `${VAULT_FOLDERS.inbox}/${slugify(title)}.md`
    let suffix = 2
    while (await fs.exists(path)) {
      path = `${VAULT_FOLDERS.inbox}/${slugify(title)}-${suffix}.md`
      suffix += 1
    }

    await fs.write(path, contents)
    return ok({ path })
  }

  async function promote(path: string): Promise<Result<{ path: string }>> {
    let source: string
    try {
      source = await fs.read(path)
    } catch {
      return err(`Could not read '${path}'.`)
    }

    const { frontmatter, body } = parseFrontmatter(source)
    if (!frontmatter) return err(`'${path}' has no valid frontmatter.`)

    const folder = DEFAULT_FOLDER[frontmatter.type]
    const target = `${folder}/${basenameSlug(path)}.md`
    if (await fs.exists(target)) return err(`'${target}' already exists.`)

    await fs.write(target, composeNote({ ...frontmatter, status: 'reviewed' }, body))
    return ok({ path: target })
  }

  async function validate(): Promise<VaultIssue[]> {
    const issues: VaultIssue[] = []
    const paths = await fs.list()
    const all = await notes()
    const known = new Set(all.map((note) => note.slug))
    for (const note of all) {
      const id = note.frontmatter.id
      if (typeof id === 'string' && id !== '') known.add(id)
    }

    // Files that parsed to nothing — missing or malformed frontmatter.
    for (const path of paths) {
      if (all.some((note) => note.path === path)) continue
      issues.push({
        path,
        severity: 'error',
        message: 'Missing or invalid frontmatter (`type` is mandatory).',
      })
    }

    const today = new Date().toISOString().slice(0, 10)

    for (const note of all) {
      for (const link of note.links) {
        if (!known.has(link)) {
          issues.push({
            path: note.path,
            severity: 'warning',
            message: `Link [[${link}]] resolves to nothing.`,
          })
        }
      }

      if (note.frontmatter.type === 'sop') {
        // An unreviewed SOP is a liability precisely because it looks
        // authoritative — people follow it.
        if (typeof note.frontmatter.lastReviewed !== 'string') {
          issues.push({ path: note.path, severity: 'error', message: 'SOP has no lastReviewed.' })
        }
        if (typeof note.frontmatter.owner !== 'string' || note.frontmatter.owner === '') {
          issues.push({ path: note.path, severity: 'warning', message: 'SOP has no owner.' })
        }
      }

      if (note.frontmatter.type === 'adr') {
        if (typeof note.frontmatter.id !== 'string' || !/^ADR-\d{4}$/.test(note.frontmatter.id)) {
          issues.push({
            path: note.path,
            severity: 'error',
            message: 'ADR id must look like ADR-0001.',
          })
        }
        if (note.frontmatter.status === 'superseded' && !note.frontmatter.supersededBy) {
          issues.push({
            path: note.path,
            severity: 'error',
            message: 'Superseded ADR does not say what replaced it.',
          })
        }
      }

      if (typeof note.frontmatter.date === 'string' && note.frontmatter.date > today) {
        issues.push({ path: note.path, severity: 'warning', message: 'Date is in the future.' })
      }

      // Defence in depth on read as well as write: anything that
      // reached disk by another route is caught before it is served.
      for (const finding of scanForIdentityData(note.body)) {
        issues.push({
          path: note.path,
          severity: 'error',
          message: `Possible ${finding.hint} on line ${finding.line} — identity data belongs in Supabase.`,
        })
      }
    }

    return issues
  }

  return { notes, get, query, search, capture, promote, validate, backlinks }
}
