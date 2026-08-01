import type { AIRouter } from '@jarvis/ai'
import { completeStructured } from '@jarvis/ai'
import type { BusinessCode, TaskClassification } from '@jarvis/shared'
import {
  BUSINESS_AGENT,
  BUSINESS_CODES,
  BUSINESS_NAMES,
  taskClassificationSchema,
} from '@jarvis/shared'

// ---------------------------------------------------------------------
// Request classification. A deterministic rule-based classifier handles
// the documented chat commands and is ALWAYS the first pass — it is
// fast, free, offline-capable and fully testable. Ambiguous free-form
// requests can optionally be refined by a model through the router;
// model output is validated against taskClassificationSchema and the
// model can never grant itself authority (requiredAuthority is clamped
// by the application in the orchestrator).
// ---------------------------------------------------------------------

export function detectBusinessCode(text: string): BusinessCode | null {
  const upper = text.toUpperCase()
  const codeMatch = upper.match(/\bA0[0-8]\b/)
  if (codeMatch) return codeMatch[0] as BusinessCode
  for (const code of BUSINESS_CODES) {
    if (new RegExp(`\\b${BUSINESS_NAMES[code]}\\b`, 'i').test(text)) return code
  }
  return null
}

function base(
  businessCode: BusinessCode,
  overrides: Partial<TaskClassification>
): TaskClassification {
  return taskClassificationSchema.parse({
    businessCode,
    intent: 'other',
    agentCode: BUSINESS_AGENT[businessCode],
    priority: 'P2',
    requiredData: [],
    requiredAuthority: 'L0',
    externalAction: false,
    approvalRequired: false,
    reasoningSummary: '',
    ...overrides,
  })
}

/**
 * Deterministic classification of the supported command set.
 * Returns null when the request needs model-assisted classification.
 */
export function classifyDeterministic(input: string): TaskClassification | null {
  const text = input.trim()
  const business = detectBusinessCode(text) ?? 'A00'

  if (
    /\b(pending )?approvals?\b/i.test(text) &&
    /\b(show|list|my|see|view|display)\b/i.test(text)
  ) {
    return base(business, {
      businessCode: detectBusinessCode(text) ?? 'A00',
      intent: 'show_approvals',
      agentCode: 'JVS-00',
      reasoningSummary: 'Explicit request to list pending approvals.',
    })
  }

  if (
    /\b(generate|create|today'?s|daily|prime)\b.*\bbrief\b/i.test(text) ||
    /\bbrief\b.*\btoday\b/i.test(text)
  ) {
    return base('A00', {
      intent: 'generate_brief',
      agentCode: 'JVS-00',
      requiredAuthority: 'L2',
      priority: 'P1',
      reasoningSummary: 'Explicit request for the daily PRIME brief.',
    })
  }

  const createTask = text.match(/\bcreate\b.*\btask\b(?:.*\bfor\b\s+(\S+))?(?:\s+to\s+(.+))?$/i)
  if (createTask) {
    const detected = detectBusinessCode(text)
    if (detected) {
      return base(detected, {
        intent: 'create_task',
        requiredAuthority: 'L1',
        requiredData: createTask[2] ? [createTask[2]] : [],
        reasoningSummary: `Task creation request for ${detected}.`,
      })
    }
  }

  if (/\breview\b.*\bperformance\b/i.test(text) || /\bperformance\b.*\breview\b/i.test(text)) {
    const detected = detectBusinessCode(text)
    if (detected) {
      return base(detected, {
        intent: 'review_performance',
        reasoningSummary: `Performance review request for ${detected}.`,
      })
    }
  }

  if (/\bcompare\b.*\brisks?\b/i.test(text) || /\brisks?\b.*\bacross\b/i.test(text)) {
    return base('A00', {
      intent: 'compare_risks',
      agentCode: 'A00-GM',
      reasoningSummary: 'Cross-business risk comparison request.',
    })
  }

  if (/\brecord\b.*\bdecision\b/i.test(text)) {
    const detected = detectBusinessCode(text) ?? 'A00'
    return base(detected, {
      intent: 'record_decision',
      requiredAuthority: 'L2',
      reasoningSummary: `Decision recording request for ${detected}.`,
    })
  }

  // External side effects — always classified as approval-gated.
  if (
    /\b(send|email|publish|post|pay|transfer|buy|purchase|deploy to production|tweet)\b/i.test(text)
  ) {
    const detected = detectBusinessCode(text) ?? 'A00'
    return base(detected, {
      intent: 'external_action',
      externalAction: true,
      approvalRequired: true,
      requiredAuthority: 'L4',
      reasoningSummary: 'Request implies an external side effect; requires PRIME approval.',
    })
  }

  return null
}

/**
 * Full classification: deterministic first, model-assisted refinement for
 * everything else. Falls back to a safe 'query' classification when no
 * provider is configured. NOTE: the returned classification is advisory —
 * authority and approvals are enforced independently by the tool pipeline.
 */
export async function classifyRequest(
  input: string,
  router: AIRouter | null
): Promise<{ classification: TaskClassification; source: 'rules' | 'model' | 'fallback' }> {
  const deterministic = classifyDeterministic(input)
  if (deterministic) return { classification: deterministic, source: 'rules' }

  if (router) {
    const result = await completeStructured(router, 'extraction', taskClassificationSchema, [
      {
        role: 'system',
        content:
          `Classify the founder's request for the JARVIS orchestrator. Businesses: ` +
          BUSINESS_CODES.map((c) => `${c}=${BUSINESS_NAMES[c]}`).join(', ') +
          `. Fields: businessCode, intent (query|create_task|create_project|record_decision|review_performance|compare_risks|generate_brief|show_approvals|external_action|other), agentCode, priority (P0-P3), requiredData (string[]), requiredAuthority (L0-L5), externalAction (bool), approvalRequired (bool), reasoningSummary (1-2 sentences, no hidden reasoning).`,
      },
      { role: 'user', content: input },
    ])
    if (result.ok) {
      const c = result.value.data
      // The model must never lower the bar for external actions.
      if (c.externalAction) c.approvalRequired = true
      return { classification: c, source: 'model' }
    }
  }

  const business = detectBusinessCode(input) ?? 'A00'
  return {
    classification: base(business, {
      intent: 'query',
      reasoningSummary: 'Unclassified request treated as a read-only query (safe default).',
    }),
    source: 'fallback',
  }
}
