// ---------------------------------------------------------------------
// Obsidian — the business brain.
//
// The boundary against Graphify, stated as a test rather than a slogan
// (docs/OBSIDIAN.md §1):
//
//   If deleting it loses nothing but time, it belongs in Graphify.
//   If deleting it loses something no one can reconstruct, it belongs
//   here.
//
// Code structure is re-derivable from code. WHY a boundary was drawn is
// not — it exists only in someone's head until written down. That
// asymmetry is the entire justification for the vault, and it is why
// nothing in this package generates call graphs, file inventories or
// symbol lists. Those are Graphify's, and a second copy of them here
// would disagree with the repository the first time code changed.
// ---------------------------------------------------------------------

export const NOTE_TYPES = [
  'adr',
  'sop',
  'business',
  'customer',
  'meeting',
  'learning',
  'ceo',
  'reference',
] as const

export type NoteType = (typeof NOTE_TYPES)[number]

export const ADR_STATUSES = ['proposed', 'accepted', 'superseded', 'rejected'] as const
export type AdrStatus = (typeof ADR_STATUSES)[number]

/**
 * Review status for anything an agent captured.
 *
 * `unreviewed` is the default for agent writes. Without it the vault
 * degrades into a second derived cache and the Graphify boundary above
 * collapses — the value of authored knowledge is that a human vouched
 * for it.
 */
export const REVIEW_STATUSES = ['unreviewed', 'reviewed'] as const
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

export interface Frontmatter {
  /** The only mandatory field: it is what makes retrieval programmatic. */
  type: NoteType
  id?: string
  title?: string
  /** ISO 8601 — no ambiguity between locales. */
  date?: string
  status?: AdrStatus | ReviewStatus | string
  tags?: string[]
  /** ADR only. The forward link from a superseded decision. */
  supersedes?: string
  supersededBy?: string
  /** ADR only. Commit the decision landed in. */
  commit?: string
  /** SOP only. An SOP without these is a liability, not documentation. */
  owner?: string
  lastReviewed?: string
  reviewCycle?: 'monthly' | 'quarterly' | 'annually' | string
  /** Business-scoped notes carry their business code. */
  business?: string
  /** Anything not modelled above, preserved rather than discarded. */
  [key: string]: unknown
}

export interface Note {
  /** Vault-relative path, POSIX separators. The note's identity. */
  path: string
  frontmatter: Frontmatter
  /** Markdown body, frontmatter removed. */
  body: string
  /** `[[target]]` references found in the body, deduplicated. */
  links: string[]
  /** Basename without extension — what a wikilink resolves against. */
  slug: string
}

/** Vault folders, from docs/OBSIDIAN.md §2. */
export const VAULT_FOLDERS = {
  inbox: '00-inbox',
  decisions: '10-decisions',
  sops: '20-sops',
  businesses: '30-businesses',
  learning: '40-learning',
  ceo: '50-ceo',
  reference: '60-reference',
  archive: '99-archive',
} as const

/**
 * Where each note type is filed by default.
 *
 * Numeric prefixes give a stable sort. Folders stay coarse on purpose —
 * links and tags carry the real structure, and deep hierarchies fight
 * the linking model rather than helping it.
 */
export const DEFAULT_FOLDER: Record<NoteType, string> = {
  adr: VAULT_FOLDERS.decisions,
  sop: VAULT_FOLDERS.sops,
  business: VAULT_FOLDERS.businesses,
  customer: VAULT_FOLDERS.businesses,
  meeting: VAULT_FOLDERS.inbox,
  learning: VAULT_FOLDERS.learning,
  ceo: VAULT_FOLDERS.ceo,
  reference: VAULT_FOLDERS.reference,
}

export interface VaultIssue {
  path: string
  severity: 'error' | 'warning'
  message: string
}
