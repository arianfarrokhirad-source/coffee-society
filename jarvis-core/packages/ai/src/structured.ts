import type { z } from 'zod'
import { err, ok, type Result } from '@jarvis/shared'
import type { AIRouter } from './router'
import type { AIMessage, AIResponse, RouteKind } from './types'

// ---------------------------------------------------------------------
// Structured output: the model is instructed to answer with JSON only;
// the response is extracted, parsed and validated with Zod. One retry
// with validation feedback. Unparseable output is an error — free text
// is never trusted for orchestration.
// ---------------------------------------------------------------------

export function extractJson(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = (fenced?.[1] ?? text).trim()
  const start = candidate.search(/[[{]/)
  if (start === -1) return null
  // Walk to the matching close bracket to tolerate trailing prose.
  const open = candidate[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }
    if (ch === '"') inString = !inString
    if (inString) continue
    if (ch === open) depth++
    if (ch === close) {
      depth--
      if (depth === 0) return candidate.slice(start, i + 1)
    }
  }
  return null
}

export interface StructuredOutcome<T> {
  data: T
  response: AIResponse
  retried: boolean
}

export async function completeStructured<S extends z.ZodTypeAny>(
  router: AIRouter,
  kind: RouteKind,
  schema: S,
  messages: AIMessage[],
  options?: { maxTokens?: number }
): Promise<Result<StructuredOutcome<z.infer<S>>>> {
  const instruction: AIMessage = {
    role: 'system',
    content:
      'Respond with a single JSON object only. No markdown, no commentary. ' +
      'The object must satisfy the schema the application validates against. ' +
      'Use null for unknown optional values; never invent data.',
  }

  const attempt = async (extra: AIMessage[]): Promise<Result<StructuredOutcome<z.infer<S>>>> => {
    const result = await router.complete(kind, {
      messages: [instruction, ...messages, ...extra],
      maxTokens: options?.maxTokens ?? 2048,
      temperature: 0,
    })
    if (!result.ok) return result
    const raw = extractJson(result.value.text)
    if (!raw) return err('Model response contained no JSON')
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return err('Model response was not valid JSON')
    }
    const validated = schema.safeParse(parsed)
    if (!validated.success) {
      return err(
        `Schema validation failed: ${validated.error.issues.map((i) => i.message).join('; ')}`
      )
    }
    return ok({ data: validated.data, response: result.value, retried: extra.length > 0 })
  }

  const first = await attempt([])
  if (first.ok) return first

  const second = await attempt([
    {
      role: 'user',
      content: `Your previous answer was rejected: ${first.error}. Respond again with valid JSON only.`,
    },
  ])
  return second
}
