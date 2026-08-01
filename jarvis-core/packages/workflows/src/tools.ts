import { z } from 'zod'
import type { JarvisStore } from '@jarvis/database'
import type { AgentDefinition } from '@jarvis/permissions'
import { canAgentAct, checkApproval } from '@jarvis/permissions'
import { generateDailyBrief } from '@jarvis/reporting'
import type { AuthorityLevel, BusinessCode } from '@jarvis/shared'
import { PRIORITY_LEVELS } from '@jarvis/shared'
import { buildAuditEvent, type RateLimiter } from '@jarvis/security'

// ---------------------------------------------------------------------
// Internal tool system (section 17). Models REQUEST tools; this pipeline
// decides whether they run. Every call is authenticated upstream,
// authorized here (agent scope + action policy + business scope),
// validated with Zod, rate limited, and audit logged. Restricted
// requests become approval records — never silent executions.
// ---------------------------------------------------------------------

export interface ToolActor {
  type: 'user' | 'agent'
  /** profile id for users, agent row id for agents */
  id: string
  authority: AuthorityLevel
  /** Present when type === 'agent'; used for scope enforcement. */
  agent?: AgentDefinition
  /** For agent actors: the human who initiated the run (for approvals). */
  onBehalfOfProfileId?: string | null
}

export interface ToolContext {
  store: JarvisStore
  organizationId: string
  /** Business the request is scoped to (null = org-level). */
  businessId: string | null
  businessCode: BusinessCode | null
  actor: ToolActor
  requestId: string
  runId?: string | null
  rateLimiter?: RateLimiter
}

export interface ToolSpec<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string
  description: string
  /** Action type checked against ACTION_POLICIES (authority + approval). */
  policyAction: string
  /** Action type checked against the agent's allowed/prohibited lists. */
  agentAction: string
  schema: S
  execute(ctx: ToolContext, args: z.infer<S>): Promise<unknown>
}

export type ToolOutcome =
  | { status: 'executed'; toolName: string; result: unknown }
  | { status: 'denied'; toolName: string; reason: string }
  | { status: 'approval_created'; toolName: string; approvalId: string; reason: string }
  | { status: 'failed'; toolName: string; error: string }

const priorityEnum = z.enum(PRIORITY_LEVELS)

function spec<S extends z.ZodTypeAny>(s: ToolSpec<S>): ToolSpec<S> {
  return s
}

export const TOOLS = {
  getBusinessSummary: spec({
    name: 'getBusinessSummary',
    description: 'Summary counts (tasks, projects, approvals, objectives) for a business.',
    policyAction: 'business.read',
    agentAction: 'read_internal',
    schema: z.object({}),
    async execute(ctx) {
      if (!ctx.businessId) throw new Error('business scope required')
      return ctx.store.getBusinessSummary(ctx.businessId)
    },
  }),

  getOpenTasks: spec({
    name: 'getOpenTasks',
    description: 'List open tasks, optionally scoped to the current business.',
    policyAction: 'task.read',
    agentAction: 'read_internal',
    schema: z.object({ allBusinesses: z.boolean().default(false) }),
    async execute(ctx, args) {
      return ctx.store.listOpenTasks(args.allBusinesses ? undefined : (ctx.businessId ?? undefined))
    },
  }),

  getPendingApprovals: spec({
    name: 'getPendingApprovals',
    description: 'List pending approval requests.',
    policyAction: 'approval.read',
    agentAction: 'read_internal',
    schema: z.object({ allBusinesses: z.boolean().default(true) }),
    async execute(ctx, args) {
      return ctx.store.listPendingApprovals(
        args.allBusinesses ? undefined : (ctx.businessId ?? undefined)
      )
    },
  }),

  searchDocuments: spec({
    name: 'searchDocuments',
    description: 'Full-text search over document metadata the requester may read.',
    policyAction: 'document.read',
    agentAction: 'read_internal',
    schema: z.object({ query: z.string().min(2).max(200) }),
    async execute(ctx, args) {
      return ctx.store.searchDocuments(args.query, ctx.businessId ?? undefined)
    },
  }),

  createTask: spec({
    name: 'createTask',
    description: 'Create a task in the current business.',
    policyAction: 'task.create',
    agentAction: 'create_task',
    schema: z.object({
      title: z.string().min(1).max(300),
      description: z.string().max(5000).nullish(),
      priority: priorityEnum.default('P2'),
      dueDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullish(),
    }),
    async execute(ctx, args) {
      if (!ctx.businessId) throw new Error('business scope required')
      return ctx.store.createTask({
        organizationId: ctx.organizationId,
        businessId: ctx.businessId,
        title: args.title,
        description: args.description ?? null,
        priority: args.priority,
        dueDate: args.dueDate ?? null,
        createdBy:
          ctx.actor.type === 'user' ? ctx.actor.id : (ctx.actor.onBehalfOfProfileId ?? null),
        createdByAgentId: ctx.actor.type === 'agent' ? ctx.actor.id : null,
      })
    },
  }),

  updateTask: spec({
    name: 'updateTask',
    description: 'Update a task (status, priority, title, due date).',
    policyAction: 'task.update',
    agentAction: 'create_task',
    schema: z.object({
      taskId: z.string().uuid(),
      title: z.string().min(1).max(300).optional(),
      status: z.enum(['todo', 'in_progress', 'blocked', 'review', 'done', 'cancelled']).optional(),
      priority: priorityEnum.optional(),
      dueDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullish(),
    }),
    async execute(ctx, args) {
      const updated = await ctx.store.updateTask(args.taskId, {
        title: args.title,
        status: args.status,
        priority: args.priority,
        dueDate: args.dueDate ?? undefined,
      })
      if (!updated) throw new Error('task not found')
      return updated
    },
  }),

  createProject: spec({
    name: 'createProject',
    description: 'Create a project in the current business.',
    policyAction: 'project.create',
    agentAction: 'create_task',
    schema: z.object({
      name: z.string().min(1).max(300),
      description: z.string().max(5000).nullish(),
      priority: priorityEnum.default('P2'),
    }),
    async execute(ctx, args) {
      if (!ctx.businessId) throw new Error('business scope required')
      return ctx.store.createProject({
        organizationId: ctx.organizationId,
        businessId: ctx.businessId,
        name: args.name,
        description: args.description ?? null,
        priority: args.priority,
        createdBy:
          ctx.actor.type === 'user' ? ctx.actor.id : (ctx.actor.onBehalfOfProfileId ?? null),
      })
    },
  }),

  recordDecision: spec({
    name: 'recordDecision',
    description: 'Record a decision with context and rationale.',
    policyAction: 'decision.record',
    agentAction: 'draft',
    schema: z.object({
      title: z.string().min(1).max(300),
      decision: z.string().min(1).max(5000),
      context: z.string().max(5000).nullish(),
      rationale: z.string().max(5000).nullish(),
    }),
    async execute(ctx, args) {
      return ctx.store.recordDecision({
        organizationId: ctx.organizationId,
        businessId: ctx.businessId,
        title: args.title,
        decision: args.decision,
        context: args.context ?? null,
        rationale: args.rationale ?? null,
        decidedBy:
          ctx.actor.type === 'user' ? ctx.actor.id : (ctx.actor.onBehalfOfProfileId ?? null),
        recordedByAgentId: ctx.actor.type === 'agent' ? ctx.actor.id : null,
      })
    },
  }),

  requestApproval: spec({
    name: 'requestApproval',
    description: 'Create an approval request for a restricted or costly action.',
    policyAction: 'approval.request',
    agentAction: 'recommend',
    schema: z.object({
      actionType: z.string().min(2).max(120),
      reason: z.string().min(1).max(2000),
      actionPayload: z.record(z.unknown()).default({}),
      estimatedCost: z.number().nonnegative().nullish(),
      currency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .nullish(),
      riskLevel: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
    }),
    async execute(ctx, args) {
      return ctx.store.createApproval({
        organizationId: ctx.organizationId,
        businessId: ctx.businessId,
        requestedByAgentId: ctx.actor.type === 'agent' ? ctx.actor.id : null,
        requestedByUserId:
          ctx.actor.type === 'user' ? ctx.actor.id : (ctx.actor.onBehalfOfProfileId ?? null),
        actionType: args.actionType,
        actionPayload: args.actionPayload as Record<string, unknown>,
        reason: args.reason,
        estimatedCost: args.estimatedCost ?? null,
        currency: args.currency ?? null,
        riskLevel: args.riskLevel,
      })
    },
  }),

  generateDailyBrief: spec({
    name: 'generateDailyBrief',
    description: 'Generate (or regenerate) the daily PRIME brief for today.',
    policyAction: 'brief.generate',
    agentAction: 'summarize',
    schema: z.object({
      briefDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    }),
    async execute(ctx, args) {
      return generateDailyBrief(ctx.store, {
        organizationId: ctx.organizationId,
        briefDate: args.briefDate,
        generatedBy:
          ctx.actor.type === 'user' ? ctx.actor.id : (ctx.actor.onBehalfOfProfileId ?? null),
      })
    },
  }),
} as const

export type ToolName = keyof typeof TOOLS

export function listToolDefinitions(): { name: string; description: string }[] {
  return Object.values(TOOLS).map((t) => ({ name: t.name, description: t.description }))
}

/**
 * The enforcement pipeline. Order matters:
 * rate limit → existence → input validation → agent scope → action policy
 * (approval creation when required) → execution → logging.
 */
export async function executeTool(
  ctx: ToolContext,
  toolName: string,
  rawArgs: unknown
): Promise<ToolOutcome> {
  const started = Date.now()
  const tool = (TOOLS as Record<string, ToolSpec>)[toolName]

  const log = async (
    status: 'denied' | 'executed' | 'failed',
    extra: { denialReason?: string; resultSummary?: string; error?: string }
  ) => {
    await ctx.store.recordToolCall({
      organizationId: ctx.organizationId,
      runId: ctx.runId ?? null,
      businessId: ctx.businessId,
      toolName,
      arguments: (rawArgs ?? {}) as Record<string, unknown>,
      status,
      denialReason: extra.denialReason ?? null,
      resultSummary: extra.resultSummary ?? null,
      error: extra.error ?? null,
      durationMs: Date.now() - started,
    })
    await ctx.store.writeAudit(
      buildAuditEvent({
        organizationId: ctx.organizationId,
        businessId: ctx.businessId,
        actorType: ctx.actor.type,
        actorId: ctx.actor.id,
        action:
          status === 'executed'
            ? 'tool.executed'
            : status === 'denied'
              ? 'permission.denied'
              : 'tool.failed',
        resourceType: 'tool',
        requestId: ctx.requestId,
        metadata: { toolName, ...(extra.denialReason ? { reason: extra.denialReason } : {}) },
      })
    )
  }

  if (ctx.rateLimiter && !(await ctx.rateLimiter.check(`${ctx.actor.type}:${ctx.actor.id}`))) {
    await log('denied', { denialReason: 'rate limited' })
    return { status: 'denied', toolName, reason: 'Rate limit exceeded. Try again shortly.' }
  }

  if (!tool) {
    await log('denied', { denialReason: 'unknown tool' })
    return { status: 'denied', toolName, reason: `Unknown tool '${toolName}'` }
  }

  const parsed = tool.schema.safeParse(rawArgs ?? {})
  if (!parsed.success) {
    const reason = `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`
    await log('denied', { denialReason: reason })
    return { status: 'denied', toolName, reason }
  }

  if (ctx.actor.type === 'agent') {
    if (!ctx.actor.agent) {
      await log('denied', { denialReason: 'agent definition missing' })
      return { status: 'denied', toolName, reason: 'Agent definition missing' }
    }
    const scope = canAgentAct(ctx.actor.agent, {
      businessCode: ctx.businessCode,
      actionType: tool.agentAction,
    })
    if (!scope.allowed) {
      await log('denied', { denialReason: scope.reason })
      return { status: 'denied', toolName, reason: scope.reason }
    }
  }

  const estimatedCost =
    typeof (parsed.data as { estimatedCost?: unknown }).estimatedCost === 'number'
      ? ((parsed.data as { estimatedCost: number }).estimatedCost ?? null)
      : null

  const approvalCheck = checkApproval({
    actionType: tool.policyAction,
    actorAuthority: ctx.actor.authority,
    actorIsAgent: ctx.actor.type === 'agent',
    estimatedCost,
    maxFinancialAuthority:
      ctx.actor.agent?.maxFinancialAuthority ??
      (ctx.actor.type === 'user' ? Number.MAX_SAFE_INTEGER : 0),
  })

  // requestApproval itself must not recurse into approval creation.
  if (!approvalCheck.allowed && toolName !== 'requestApproval') {
    const approval = await ctx.store.createApproval({
      organizationId: ctx.organizationId,
      businessId: ctx.businessId,
      requestedByAgentId: ctx.actor.type === 'agent' ? ctx.actor.id : null,
      requestedByUserId:
        ctx.actor.type === 'user' ? ctx.actor.id : (ctx.actor.onBehalfOfProfileId ?? null),
      actionType: tool.policyAction,
      actionPayload: { tool: toolName, arguments: parsed.data as Record<string, unknown> },
      reason: approvalCheck.reason,
      estimatedCost,
      riskLevel: approvalCheck.risk,
    })
    await ctx.store.writeAudit(
      buildAuditEvent({
        organizationId: ctx.organizationId,
        businessId: ctx.businessId,
        actorType: ctx.actor.type,
        actorId: ctx.actor.id,
        action: 'approval.requested',
        resourceType: 'approval',
        resourceId: approval.id,
        requestId: ctx.requestId,
        metadata: { toolName, reason: approvalCheck.reason },
      })
    )
    await ctx.store.recordToolCall({
      organizationId: ctx.organizationId,
      runId: ctx.runId ?? null,
      businessId: ctx.businessId,
      toolName,
      arguments: parsed.data as Record<string, unknown>,
      status: 'denied',
      denialReason: `approval required: ${approvalCheck.reason}`,
      durationMs: Date.now() - started,
    })
    return {
      status: 'approval_created',
      toolName,
      approvalId: approval.id,
      reason: approvalCheck.reason,
    }
  }

  if (!approvalCheck.allowed && toolName === 'requestApproval') {
    // Creating an approval request is itself permitted at L1; reaching
    // here means even that was denied (e.g. L0 actor) — deny plainly.
    await log('denied', { denialReason: approvalCheck.reason })
    return { status: 'denied', toolName, reason: approvalCheck.reason }
  }

  try {
    const result = await tool.execute(ctx, parsed.data)
    await log('executed', { resultSummary: summarize(result) })
    return { status: 'executed', toolName, result }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    await log('failed', { error: message })
    return { status: 'failed', toolName, error: message }
  }
}

function summarize(result: unknown): string {
  if (result == null) return 'null'
  if (Array.isArray(result)) return `${result.length} row(s)`
  if (typeof result === 'object' && 'id' in (result as Record<string, unknown>)) {
    return `record ${(result as { id: string }).id}`
  }
  return typeof result
}
