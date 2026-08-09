// ---------------------------------------------------------------------
// Identity-data guard.
//
// docs/OBSIDIAN.md §5: "Retrieval refuses to return anything matching
// identity-data patterns, as defence in depth."
//
// Defence in depth is the operative phrase. The real control is not
// writing identity data into a note in the first place; Supabase is the
// authoritative and only store for it. This layer exists because that
// control is a human one, and human controls fail — someone pastes a
// meeting transcript with a phone number in it and does not think twice.
//
// So it runs in BOTH directions, which is the part that is easy to get
// wrong: blocking on write alone leaves anything already in the vault
// readable forever, and blocking on read alone lets the data accumulate
// on disk where a backup or a sync will carry it somewhere else.
//
// It is deliberately conservative and will produce false positives. A
// refused note is an inconvenience; a leaked identity is not, and the
// asymmetry is what sets the threshold.
// ---------------------------------------------------------------------

export type IdentityFinding = {
  kind: 'email' | 'phone' | 'iban' | 'card' | 'date_of_birth' | 'secret' | 'identity_field'
  /** 1-indexed line in the scanned text. */
  line: number
  /** Never the matched value itself — that would leak it into logs. */
  hint: string
}

interface Rule {
  kind: IdentityFinding['kind']
  pattern: RegExp
  hint: string
}

const RULES: Rule[] = [
  {
    kind: 'email',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
    hint: 'email address',
  },
  {
    // International and grouped national formats. Requires 9+ digits so
    // ordinary numbers in prose ("400 EUR", "2026") do not trip it.
    kind: 'phone',
    pattern: /(?:\+\d[\d\s().-]{8,}\d)|(?:\b0\d[\d\s().-]{7,}\d\b)/,
    hint: 'telephone number',
  },
  {
    kind: 'iban',
    pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/,
    hint: 'bank account identifier',
  },
  {
    kind: 'card',
    pattern: /\b(?:\d[ -]?){13,19}\b/,
    hint: 'payment card number',
  },
  {
    kind: 'secret',
    pattern:
      /\b(?:sk-[A-Za-z0-9_-]{8,}|sk_live_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+|eyJ[A-Za-z0-9_-]{10,})/,
    hint: 'credential or token',
  },
  {
    kind: 'date_of_birth',
    pattern: /\b(?:date[_\s-]?of[_\s-]?birth|dob|birth[_\s-]?date|born\s+on)\b\s*[:=]?/i,
    hint: 'date of birth',
  },
  {
    kind: 'identity_field',
    pattern:
      /^\s*(?:full[_\s-]?name|display[_\s-]?name|phone(?:[_\s-]?number)?|passport|national[_\s-]?insurance|ssn|sex|gender)\s*:/i,
    hint: 'identity field in frontmatter or a list',
  },
]

/**
 * Scans text for identity data.
 *
 * Findings carry a line number and a category, never the matched text —
 * a guard that echoes what it caught into a log has moved the leak
 * rather than stopped it.
 */
export function scanForIdentityData(text: string): IdentityFinding[] {
  const findings: IdentityFinding[] = []
  const lines = text.split('\n')

  for (let i = 0; i < lines.length; i += 1) {
    // URLs and wikilinks are masked rather than causing the whole line
    // to be skipped. Their digits produce constant card/phone false
    // positives, but skipping the line would also blind the scanner to
    // a real address sitting next to a link on the same line.
    const line = (lines[i] ?? '').replace(/https?:\/\/\S+/g, ' ').replace(/\[\[[^\]]*\]\]/g, ' ')

    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        findings.push({ kind: rule.kind, line: i + 1, hint: rule.hint })
      }
    }
  }

  return findings
}

export class IdentityDataError extends Error {
  findings: IdentityFinding[]
  constructor(path: string, findings: IdentityFinding[]) {
    super(
      `Refused '${path}': ${findings.length} identity-data match(es) — ` +
        findings.map((finding) => `${finding.hint} (line ${finding.line})`).join(', ') +
        '. Identity data belongs in Supabase; reference individuals by their identifier.'
    )
    this.name = 'IdentityDataError'
    this.findings = findings
  }
}

export function assertNoIdentityData(path: string, text: string): void {
  const findings = scanForIdentityData(text)
  if (findings.length > 0) throw new IdentityDataError(path, findings)
}
