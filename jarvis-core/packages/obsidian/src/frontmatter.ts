import { NOTE_TYPES, type Frontmatter, type NoteType } from './types'

// ---------------------------------------------------------------------
// Frontmatter — the machine-readable surface of human prose.
//
// A deliberately small YAML subset: scalars, inline lists, and block
// lists. Not a YAML parser, and it should never become one. Obsidian
// frontmatter that needs anchors, multi-line folded scalars or nested
// maps is frontmatter being used as a database, which is the point at
// which the data belongs in Supabase instead.
//
// The subset is chosen so that what a human types in Obsidian round
// trips exactly. Unknown keys are preserved rather than dropped —
// discarding a field someone deliberately added is a quiet way to lose
// their work.
// ---------------------------------------------------------------------

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

export interface ParsedNote {
  frontmatter: Frontmatter | null
  body: string
}

function parseScalar(raw: string): unknown {
  const value = raw.trim()
  if (value === '') return ''

  // Quoted stays a string, always. `date: "2026-08-08"` means the author
  // wanted a string, and coercing it would silently change their intent.
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
    (value.startsWith("'") && value.endsWith("'") && value.length > 1)
  ) {
    return value.slice(1, -1)
  }

  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null' || value === '~') return null

  // Inline list: [a, b, c]
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim()
    if (inner === '') return []
    return inner.split(',').map((entry) => parseScalar(entry))
  }

  // Numbers, but NOT things that merely start with digits. '2026-08-08'
  // is a date and must stay a string; Number() would give NaN and a
  // looser check would mangle it.
  if (/^-?\d+$/.test(value)) return Number(value)
  if (/^-?\d*\.\d+$/.test(value)) return Number(value)

  return value
}

/**
 * Splits frontmatter from body.
 *
 * Returns `frontmatter: null` when the block is absent or malformed,
 * never a partial object — a half-parsed header would make a note look
 * classified when it is not.
 */
export function parseFrontmatter(source: string): ParsedNote {
  const match = FRONTMATTER_PATTERN.exec(source)
  if (!match) return { frontmatter: null, body: source }

  const block = match[1] ?? ''
  const body = source.slice(match[0].length)
  const parsed: Record<string, unknown> = {}

  let currentKey: string | null = null
  let blockList: unknown[] | null = null

  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (line.trim() === '' || line.trim().startsWith('#')) continue

    // Block list item: `  - value`
    const listItem = /^\s+-\s*(.*)$/.exec(line)
    if (listItem && currentKey !== null) {
      if (blockList === null) blockList = []
      blockList.push(parseScalar(listItem[1] ?? ''))
      parsed[currentKey] = blockList
      continue
    }

    const entry = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (!entry) continue

    const key = entry[1]
    const value = entry[2] ?? ''
    if (!key) continue

    currentKey = key
    blockList = null

    // An empty value may be the header of a block list; it becomes []
    // only if list items follow, so `title:` stays an empty string.
    parsed[key] = value.trim() === '' ? '' : parseScalar(value)
  }

  const type = parsed.type
  if (typeof type !== 'string' || !NOTE_TYPES.includes(type as NoteType)) {
    // `type` is the one mandatory field. Without it nothing can query
    // the note, so it is not a valid vault note.
    return { frontmatter: null, body }
  }

  return { frontmatter: parsed as Frontmatter, body }
}

function serialiseScalar(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return `[${value.map((entry) => serialiseScalar(entry)).join(', ')}]`

  const text = String(value)
  // Quote anything that would otherwise re-parse as a different type, or
  // that contains structural characters. Round-tripping must be exact.
  if (
    text === '' ||
    /^(true|false|null|~)$/.test(text) ||
    /^-?\d+(\.\d+)?$/.test(text) ||
    /[:#[\]{}",]/.test(text) ||
    text !== text.trim()
  ) {
    return `"${text.replace(/"/g, '\\"')}"`
  }
  return text
}

/** Writes frontmatter back, with `type` first so it is always visible. */
export function serialiseFrontmatter(frontmatter: Frontmatter): string {
  const keys = Object.keys(frontmatter).filter((key) => key !== 'type')
  const lines = [`type: ${serialiseScalar(frontmatter.type)}`]
  for (const key of keys) {
    const value = frontmatter[key]
    if (value === undefined) continue
    lines.push(`${key}: ${serialiseScalar(value)}`)
  }
  return `---\n${lines.join('\n')}\n---\n`
}

export function composeNote(frontmatter: Frontmatter, body: string): string {
  return `${serialiseFrontmatter(frontmatter)}\n${body.trimStart()}`
}

const WIKILINK_PATTERN = /\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g

/**
 * Extracts `[[target]]` references.
 *
 * Aliases (`[[target|shown as]]`) and headings (`[[target#section]]`)
 * are stripped to the target, because the graph edge is to the note,
 * not to the display text.
 */
export function extractLinks(body: string): string[] {
  const links = new Set<string>()
  WIKILINK_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = WIKILINK_PATTERN.exec(body)) !== null) {
    const target = match[1]?.trim()
    if (target) links.add(target)
  }
  return [...links]
}
