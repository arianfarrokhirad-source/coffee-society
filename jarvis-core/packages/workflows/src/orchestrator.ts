import { randomUUID } from 'node:crypto'
import { composePrompt } from '@jarvis/agents'
import type { AIRouter } from '@jarvis/ai'
import { completeStructured } from '@jarvis/ai'
import type { AgentRow, JarvisStore } from '@jarvis/database'
import type { AgentDefinition } from '@jarvis/permissions'
import type {
  AgentCode,
  AIProviderName,
  AuthorityLevel,
  BusinessCode,
  ExecutiveResponse,
  TaskClassification,
} from '@jarvis/shared'
import { BUSINESS_NAMES, executiveResponseSchema } from '@jarvis/shared'
import { buildAuditEvent, type RateLimiter } from '@jarvis/security'
import { classifyRequest } from './classifier'
import { executeTool, type ToolContext, type ToolOutcome } from './tools'

// ---------------------------------------------------------------------
// JVS-00 orchestration (section 14). Every run:
//  1. requester already authenticated (verified user passed in by the
//     server action — never trusted from the client body)
//  2. determine the relevant business
//  3. classify the request
//  4. determine required authority (application decides, not the model)
//  5. retrieve only authorized information (via scoped tools)
//  6. select the specialist agent
//  7. select the model route
//  8. provide only permitted tools
//  9. validate the model response (Zod)
// 10. create an approval when required
// 11. log the complete run (agent_runs, tool_calls, audit_logs)
// 12. return a structured response
// ---------------------------------------------------------------------

export interface JarvisUser {
  profileId: string
  authority: AuthorityLevel
  isPrime: boolean
}

export interface JarvisDeps {
  store: JarvisStore
  router: AIRouter | null
  rateLimiter?: RateLimiter
}

export interface JarvisInput {
  message: string
  /** Explicit business selection, or 'auto' for routing. */
  business: BusinessCode | 'auto'
}

export interface JarvisReply {
  runId: string | null
  requestId: string
  businessCode: BusinessCode | null
  agentCode: AgentCode
  provider: AIProviderName | 'none'
  model: string | null
  intent: TaskClassification['intent']
  text: string
  structured: ExecutiveResponse | null
  approvalId: string | null
  toolOutcomes: ToolOutcome[]
  classificationSource: 'rules' | 'model' | 'fallback'
}

function agentRowToDefinition(row: AgentRow, businessCode: BusinessCode | null): AgentDefinition {
  return {
    code: row.code,
    businessCode,
    authorityLevel: row.authority_level,
    allowedActionTypes: row.allowed_action_types,
    prohibitedActionTypes: row.prohibited_action_types,
    maxFinancialAuthority: Number(row.max_financial_authority),
    active: row.active,
  }
}

function formatToolResult(outcome: ToolOutcome): string {
  switch (outcome.status) {
    case 'executed':
      return formatExecuted(outcome.toolName, outcome.result)
    case 'approval_created':
      return `⚠ Approval required — request ${outcome.approvalId.slice(0, 8)} created: ${outcome.reason}. It is waiting in the Approval Centre.`
    case 'denied':
      return `✗ ${outcome.toolName} denied: ${outcome.reason}`
    case 'failed':
      return `✗ ${outcome.toolName} failed: ${outcome.error}`
  }
}

function formatExecuted(toolName: string, result: unknown): string {
  if (Array.isArray(result)) {
    if (result.length === 0) return 'Nothing found.'
    const lines = result.slice(0, 15).map((row) => {
      const r = row as Record<string, unknown>
      const label = (r.title ?? r.name ?? r.action_type ?? r.id) as string
      const status = r.status ? ` [${String(r.status)}]` : ''
      const priority = r.priority ? ` (${String(r.priority)})` : ''
      return `• ${label}${status}${priority}`
    })
    const more = result.length > 15 ? `\n…and ${result.length - 15} more` : ''
    return `${lines.join('\n')}${more}`
  }
  if (toolName === 'getBusinessSummary' && result && typeof result === 'object') {
    const s = result as {
      business: { code: string; name: string; status: string }
      openTasks: number
      activeProjects: number
      pendingApprovals: number
      openObjectives: number
    }
    return `${s.business.code} ${s.business.name} [${s.business.status}]\n• Open tasks: ${s.openTasks}\n• Active projects: ${s.activeProjects}\n• Pending approvals: ${s.pendingApprovals}\n• Open objectives: ${s.openObjectives}`
  }
  if (toolName === 'generateDailyBrief' && result && typeof result === 'object') {
    const { content } = result as { content: Record<string, string[] | string> }
    const section = (key: string, title: string) => {
      const items = content[key]
      return Array.isArray(items) && items.length > 0
        ? `${title}\n${items.map((i) => `• ${i}`).join('\n')}`
        : `${title}\n• Nothing to report.`
    }
    return [
      `DAILY PRIME BRIEF — ${String(content.briefDate)}`,
      section('money', 'MONEY'),
      section('threats', 'THREATS'),
      section('opportunities', 'OPPORTUNITIES'),
      section('approvals', 'APPROVALS'),
      section('todaysPriority', "TODAY'S PRIORITY"),
      section('systemHealth', 'SYSTEM HEALTH'),
    ].join('\n\n')
  }
  if (result && typeof result === 'object' && 'id' in (result as Record<string, unknown>)) {
    const r = result as Record<string, unknown>
    return `✓ Created ${String(r.title ?? r.name ?? 'record')} (${String(r.id).slice(0, 8)})`
  }
  return '✓ Done.'
}

export async function runJarvis(
  deps: JarvisDeps,
  user: JarvisUser,
  input: JarvisInput
): Promise<JarvisReply> {
  const requestId = randomUUID()
  const { store, router } = deps

  const organizationId = await store.getOrganizationId()
  if (!organizationId) {
    return {
      runId: null,
      requestId,
      businessCode: null,
      agentCode: 'JVS-00',
      provider: 'none',
      model: null,
      intent: 'other',
      text: 'JARVIS is not initialised: no organization found. Run the seed script first.',
      structured: null,
      approvalId: null,
      toolOutcomes: [],
      classificationSource: 'fallback',
    }
  }

  // Steps 2-4: business + classification + required authority.
  const { classification, source } = await classifyRequest(input.message, router)
  const businessCode: BusinessCode =
    input.business !== 'auto' ? input.business : classification.businessCode
  const business = await store.getBusinessByCode(businessCode)
  const agentCode: AgentCode =
    classification.agentCode === 'JVS-00' || input.business === 'auto'
      ? classification.agentCode
      : classification.agentCode

  // Step 6: load the specialist agent definition from the database.
  const agentRow = await store.getAgentByCode(agentCode)
  const orchestratorRow = await store.getAgentByCode('JVS-00')

  // Step 11 begins: create the run record up front so failures are logged too.
  const run = await store.createAgentRun({
    organizationId,
    businessId: business?.id ?? null,
    agentId: agentRow?.id ?? orchestratorRow?.id ?? null,
    requestedBy: user.profileId,
    requestId,
    intent: classification.intent,
    inputSummary: input.message.slice(0, 500),
  })

  await store.writeAudit(
    buildAuditEvent({
      organizationId,
      businessId: business?.id ?? null,
      actorType: 'user',
      actorId: user.profileId,
      action: 'agent.run.started',
      resourceType: 'agent_run',
      resourceId: run.id,
      requestId,
      metadata: { intent: classification.intent, business: businessCode, source },
    })
  )

  const finish = async (
    reply: Omit<JarvisReply, 'runId' | 'requestId' | 'classificationSource'>,
    status: 'completed' | 'failed' | 'requires_approval'
  ): Promise<JarvisReply> => {
    await store.updateAgentRun(run.id, {
      status,
      provider: reply.provider,
      model: reply.model,
      outputSummary: reply.text.slice(0, 1000),
      rationale: classification.reasoningSummary || null,
      approvalId: reply.approvalId,
      finishedAt: new Date().toISOString(),
    })
    await store.createSystemEvent({
      organizationId,
      businessId: business?.id ?? null,
      eventType: status === 'failed' ? 'agent.run.failed' : 'agent.run.completed',
      payload: { runId: run.id, intent: classification.intent },
      dedupeKey: run.id,
    })
    return { ...reply, runId: run.id, requestId, classificationSource: source }
  }

  // Dormant business guard (A08 VOID).
  if (business && (business.status !== 'active' || !business.agents_enabled)) {
    return finish(
      {
        businessCode,
        agentCode: 'JVS-00',
        provider: 'none',
        model: null,
        intent: classification.intent,
        text: `${business.code} ${business.name} is ${business.status} and its agents are ${business.agents_enabled ? 'enabled' : 'disabled'}. No actions were taken.`,
        structured: null,
        approvalId: null,
        toolOutcomes: [],
      },
      'completed'
    )
  }

  // Step 8: tool context with ONLY application-decided permissions. The
  // acting authority is the MINIMUM of the user's authority and the
  // agent's authority — an agent never inherits PRIME's level, and a
  // low-authority user cannot escalate through an agent.
  const agentDef = agentRow ? agentRowToDefinition(agentRow, businessCode) : null
  // Direct commands JARVIS executes for the user run under the USER's
  // authority (PRIME generating a brief is not an agent acting). Business
  // work delegated to a specialist agent runs under the AGENT's authority,
  // so an agent can never borrow PRIME's level.
  const userDirectIntents = new Set(['show_approvals', 'generate_brief'])
  const actingAsAgent = agentDef != null && !userDirectIntents.has(classification.intent)
  const toolCtx: ToolContext = {
    store,
    organizationId,
    businessId: business?.id ?? null,
    businessCode,
    actor:
      actingAsAgent && agentRow
        ? {
            type: 'agent',
            id: agentRow.id,
            authority: agentDef.authorityLevel,
            agent: agentDef,
            onBehalfOfProfileId: user.profileId,
          }
        : { type: 'user', id: user.profileId, authority: user.authority },
    requestId,
    runId: run.id,
    rateLimiter: deps.rateLimiter,
  }

  const toolOutcomes: ToolOutcome[] = []
  const call = async (toolName: string, args: unknown): Promise<ToolOutcome> => {
    const outcome = await executeTool(toolCtx, toolName, args)
    toolOutcomes.push(outcome)
    return outcome
  }

  const baseReply = {
    businessCode,
    agentCode,
    provider: 'none' as const,
    model: null,
    structured: null,
    approvalId: null,
  }

  try {
    switch (classification.intent) {
      case 'show_approvals': {
        const outcome = await call('getPendingApprovals', { allBusinesses: true })
        return finish(
          {
            ...baseReply,
            agentCode: 'JVS-00',
            intent: classification.intent,
            text:
              outcome.status === 'executed' &&
              Array.isArray(outcome.result) &&
              outcome.result.length === 0
                ? 'No pending approvals. All clear.'
                : formatToolResult(outcome),
            toolOutcomes,
          },
          'completed'
        )
      }

      case 'generate_brief': {
        const outcome = await call('generateDailyBrief', {})
        return finish(
          {
            ...baseReply,
            agentCode: 'JVS-00',
            intent: classification.intent,
            text: formatToolResult(outcome),
            approvalId: outcome.status === 'approval_created' ? outcome.approvalId : null,
            toolOutcomes,
          },
          outcome.status === 'approval_created' ? 'requires_approval' : 'completed'
        )
      }

      case 'create_task': {
        const title =
          classification.requiredData[0]?.trim() ||
          input.message
            .replace(/^.*?\btask\b/i, '')
            .replace(/^\s*(for|to)\s+/i, '')
            .trim() ||
          input.message.trim()
        const outcome = await call('createTask', {
          title: title.slice(0, 300),
          priority: classification.priority,
        })
        return finish(
          {
            ...baseReply,
            intent: classification.intent,
            text: formatToolResult(outcome),
            approvalId: outcome.status === 'approval_created' ? outcome.approvalId : null,
            toolOutcomes,
          },
          outcome.status === 'approval_created' ? 'requires_approval' : 'completed'
        )
      }

      case 'external_action': {
        // Step 10: restricted requests become approval records, always.
        const outcome = await call('requestApproval', {
          actionType: 'external.execute',
          reason: `Requested via JARVIS chat: "${input.message.slice(0, 500)}"`,
          actionPayload: { message: input.message },
          riskLevel: 'high',
        })
        const approvalId =
          outcome.status === 'executed'
            ? ((outcome.result as { id: string }).id ?? null)
            : outcome.status === 'approval_created'
              ? outcome.approvalId
              : null
        return finish(
          {
            ...baseReply,
            intent: classification.intent,
            text: approvalId
              ? `This is an external action, which I cannot execute. Approval request ${approvalId.slice(0, 8)} has been created for PRIME review.`
              : formatToolResult(outcome),
            approvalId,
            toolOutcomes,
          },
          'requires_approval'
        )
      }

      case 'review_performance':
      case 'compare_risks':
      case 'query':
      case 'other':
      default: {
        // Step 5: retrieve only authorized data through scoped tools.
        const summaryOutcome = await call('getBusinessSummary', {})
        const tasksOutcome = await call('getOpenTasks', {
          allBusinesses: classification.intent === 'compare_risks',
        })
        const approvalsOutcome = await call('getPendingApprovals', { allBusinesses: true })

        const authorizedData: string[] = []
        for (const outcome of [summaryOutcome, tasksOutcome, approvalsOutcome]) {
          if (outcome.status === 'executed') {
            authorizedData.push(`${outcome.toolName}: ${formatToolResult(outcome)}`)
          }
        }

        // Step 7: model route. Executive reasoning for reviews/queries.
        if (router) {
          const prompt = composePrompt({
            agentCode,
            businessCode,
            authorizedData,
            taskPacket: input.message,
          })
          const structured = await completeStructured(
            router,
            'executive',
            executiveResponseSchema,
            [
              { role: 'system', content: prompt.system },
              { role: 'user', content: prompt.user },
            ]
          )
          if (structured.ok) {
            const data = structured.value.data
            await store.recordModelUsage({
              organizationId,
              runId: run.id,
              provider: structured.value.response.provider,
              model: structured.value.response.model,
              inputTokens: structured.value.response.usage?.inputTokens ?? null,
              outputTokens: structured.value.response.usage?.outputTokens ?? null,
              latencyMs: structured.value.response.latencyMs,
              success: true,
            })
            const text = [
              `${data.business} ${BUSINESS_NAMES[data.business]} — ${data.objective}`,
              data.currentStatus,
              data.keyFindings.length
                ? `Key findings:\n${data.keyFindings.map((f) => `• ${f}`).join('\n')}`
                : '',
              data.risks.length
                ? `Risks:\n${data.risks.map((r) => `• [${r.level}] ${r.description}`).join('\n')}`
                : '',
              data.recommendedActions.length
                ? `Recommended actions:\n${data.recommendedActions.map((a) => `• (${a.priority}) ${a.action}${a.requiresApproval ? ' — requires approval' : ''}`).join('\n')}`
                : '',
              data.missingInformation.length
                ? `Missing information:\n${data.missingInformation.map((m) => `• ${m}`).join('\n')}`
                : '',
            ]
              .filter(Boolean)
              .join('\n\n')
            return finish(
              {
                ...baseReply,
                provider: structured.value.response.provider,
                model: structured.value.response.model,
                intent: classification.intent,
                text,
                structured: data,
                toolOutcomes,
              },
              'completed'
            )
          }
          // Model failed → fall through to deterministic summary (graceful).
        }

        const fallbackText = [
          authorizedData.length > 0
            ? authorizedData.join('\n\n')
            : 'No data available for this request yet.',
          router
            ? 'Note: the AI provider was unavailable; this is a direct data summary.'
            : 'Note: no AI provider is configured; this is a direct data summary. Supported commands: "Show my pending approvals", "Review A01 performance", "Create a task for FORGE to …", "Compare current project risks", "Generate today\'s PRIME brief".',
        ].join('\n\n')
        return finish(
          {
            ...baseReply,
            intent: classification.intent,
            text: fallbackText,
            toolOutcomes,
          },
          'completed'
        )
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    return finish(
      {
        ...baseReply,
        intent: classification.intent,
        text: 'The request could not be completed. The failure has been logged.',
        toolOutcomes,
      },
      'failed'
    ).then((reply) => {
      void store.writeAudit(
        buildAuditEvent({
          organizationId,
          actorType: 'system',
          action: 'agent.run.error',
          resourceType: 'agent_run',
          resourceId: run.id,
          requestId,
          metadata: { error: message },
        })
      )
      return reply
    })
  }
}
