import { composeNote } from './frontmatter'
import type { Frontmatter } from './types'

// ---------------------------------------------------------------------
// Note templates.
//
// The headings are not decoration — each one is a question the author
// would otherwise skip. "Alternatives considered" is the section future
// readers actually need and the one nobody writes unprompted; leaving it
// in the template is the cheapest way to get it written.
// ---------------------------------------------------------------------

export interface AdrInput {
  id: string
  title: string
  context: string
  decision: string
  consequences: string
  alternatives: string
  tags?: string[]
  supersedes?: string
  commit?: string
}

/**
 * An ADR, created as `proposed`.
 *
 * Never created `accepted`: acceptance is a human act, and a record that
 * proposes and accepts itself in one step documents nothing.
 */
export function renderAdr(input: AdrInput): string {
  const frontmatter: Frontmatter = {
    type: 'adr',
    id: input.id,
    title: input.title,
    status: 'proposed',
    date: new Date().toISOString().slice(0, 10),
    ...(input.tags && input.tags.length > 0 ? { tags: input.tags } : {}),
    ...(input.supersedes ? { supersedes: input.supersedes } : {}),
    ...(input.commit ? { commit: input.commit } : {}),
  }

  const body = [
    `# ${input.id} — ${input.title}`,
    '',
    '## Context',
    '',
    input.context,
    '',
    '## Decision',
    '',
    input.decision,
    '',
    '## Consequences',
    '',
    // Stated in the template because an ADR listing only upsides was
    // not a decision, it was an announcement.
    input.consequences,
    '',
    '## Alternatives considered',
    '',
    input.alternatives,
    '',
  ].join('\n')

  return composeNote(frontmatter, body)
}

export interface SopInput {
  title: string
  owner: string
  reviewCycle?: 'monthly' | 'quarterly' | 'annually'
  appliesWhen: string
  prerequisites: string
  steps: string[]
  verification: string
  failureModes: string
  escalation: string
  tags?: string[]
}

export function renderSop(input: SopInput): string {
  const frontmatter: Frontmatter = {
    type: 'sop',
    title: input.title,
    owner: input.owner,
    lastReviewed: new Date().toISOString().slice(0, 10),
    reviewCycle: input.reviewCycle ?? 'quarterly',
    ...(input.tags && input.tags.length > 0 ? { tags: input.tags } : {}),
  }

  const body = [
    `# SOP — ${input.title}`,
    '',
    '## When this applies',
    '',
    input.appliesWhen,
    '',
    '## Prerequisites',
    '',
    input.prerequisites,
    '',
    '## Steps',
    '',
    // Numbered, imperative, one action each: a step containing two
    // actions is the one people half-complete.
    ...input.steps.map((step, index) => `${index + 1}. ${step}`),
    '',
    '## Verification',
    '',
    input.verification,
    '',
    '## Failure modes',
    '',
    input.failureModes,
    '',
    '## Escalation',
    '',
    input.escalation,
    '',
  ].join('\n')

  return composeNote(frontmatter, body)
}

export interface MeetingInput {
  title: string
  date?: string
  /** Roles or Supabase identifiers — never personal detail. */
  participants: string[]
  notes: string
  decisions?: string[]
  actions?: string[]
  business?: string
}

export function renderMeeting(input: MeetingInput): string {
  const frontmatter: Frontmatter = {
    type: 'meeting',
    title: input.title,
    date: input.date ?? new Date().toISOString().slice(0, 10),
    status: 'unreviewed',
    ...(input.business ? { business: input.business } : {}),
  }

  const body = [
    `# ${input.title}`,
    '',
    // Roles, not names: the vault records business facts, and who
    // attended is an identity detail Supabase owns.
    `**Participants:** ${input.participants.join(', ')}`,
    '',
    '## Notes',
    '',
    input.notes,
    ...(input.decisions && input.decisions.length > 0
      ? ['', '## Decisions', '', ...input.decisions.map((entry) => `- ${entry}`)]
      : []),
    ...(input.actions && input.actions.length > 0
      ? ['', '## Actions', '', ...input.actions.map((entry) => `- [ ] ${entry}`)]
      : []),
    '',
  ].join('\n')

  return composeNote(frontmatter, body)
}

export interface LearningInput {
  title: string
  concept: string
  whyItMatters: string
  commonMistakes: string
  furtherReading?: string
  tags?: string[]
}

/** A PRIME engineering note: one concept, linked to the work that raised it. */
export function renderLearning(input: LearningInput): string {
  const frontmatter: Frontmatter = {
    type: 'learning',
    title: input.title,
    date: new Date().toISOString().slice(0, 10),
    ...(input.tags && input.tags.length > 0 ? { tags: input.tags } : {}),
  }

  const body = [
    `# ${input.title}`,
    '',
    '## The concept',
    '',
    input.concept,
    '',
    '## Why it matters',
    '',
    input.whyItMatters,
    '',
    '## Common mistakes',
    '',
    input.commonMistakes,
    ...(input.furtherReading ? ['', '## Further reading', '', input.furtherReading] : []),
    '',
  ].join('\n')

  return composeNote(frontmatter, body)
}
