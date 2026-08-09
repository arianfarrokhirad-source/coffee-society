import { createHash, randomUUID } from 'node:crypto'
import type { AgentCode, BusinessCode } from '@jarvis/shared'
import { approvalTransitionAllowed, BUSINESS_NAMES, isRequestOrigin } from '@jarvis/shared'
import type { PersistableAuditEvent } from './audit'
import type {
  BriefData,
  CreateAgentRunInput,
  CreateApprovalInput,
  CreateNotificationInput,
  CreateProjectInput,
  CreateSystemEventInput,
  CreateTaskInput,
  JarvisStore,
  RecordDecisionInput,
  RecordModelUsageInput,
  RecordToolCallInput,
  ResolveApprovalInput,
  UpdateAgentRunInput,
  UpdateTaskInput,
} from './store'
import type {
  AgentRow,
  AgentRunRow,
  ApprovalRow,
  BusinessRow,
  DailyBriefRow,
  DecisionRow,
  DocumentRow,
  NotificationRow,
  ObjectiveRow,
  ProjectRow,
  TaskRow,
} from './types'

// In-memory JarvisStore mirroring the seed data. Used by unit tests and
// as a truthful "no database configured" development fallback. State is
// per-instance and non-persistent by design.

const now = () => new Date().toISOString()

// Approval audit rows record a hash of the payload, never the payload
// itself, so a secret inside an action argument cannot be read back out
// of the audit log. Matches the encode(sha256(...), 'hex') the RPCs use.
const sha256Of = (payload: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(payload ?? {}))
    .digest('hex')

export interface InMemoryState {
  organizationId: string
  businesses: BusinessRow[]
  agents: AgentRow[]
  tasks: TaskRow[]
  projects: ProjectRow[]
  objectives: ObjectiveRow[]
  decisions: DecisionRow[]
  approvals: ApprovalRow[]
  notifications: NotificationRow[]
  documents: DocumentRow[]
  agentRuns: AgentRunRow[]
  toolCalls: RecordToolCallInput[]
  modelUsage: RecordModelUsageInput[]
  auditEvents: PersistableAuditEvent[]
  systemEvents: CreateSystemEventInput[]
  dailyBriefs: DailyBriefRow[]
}

function seedBusinesses(orgId: string): BusinessRow[] {
  return (Object.keys(BUSINESS_NAMES) as BusinessCode[]).map((code) => ({
    id: randomUUID(),
    organization_id: orgId,
    code,
    name: BUSINESS_NAMES[code],
    description: null,
    status: code === 'A08' ? 'dormant' : 'active',
    agents_enabled: code !== 'A08',
    created_at: now(),
    updated_at: now(),
  }))
}

function seedAgents(orgId: string, businesses: BusinessRow[]): AgentRow[] {
  const byCode = new Map(businesses.map((b) => [b.code, b]))
  const defs: {
    code: AgentCode
    business: BusinessCode | null
    active: boolean
    allowed: string[]
    prohibited: string[]
  }[] = [
    {
      code: 'JVS-00',
      business: null,
      active: true,
      allowed: ['classify', 'route', 'summarize', 'read_internal'],
      prohibited: ['external_side_effect', 'financial_execution', 'permission_change'],
    },
    {
      code: 'A00-GM',
      business: 'A00',
      active: true,
      allowed: ['read_internal', 'draft', 'recommend'],
      prohibited: ['external_side_effect', 'financial_execution', 'permission_change'],
    },
    {
      code: 'A01-GM',
      business: 'A01',
      active: true,
      allowed: ['read_internal', 'draft', 'recommend', 'create_task'],
      prohibited: ['external_side_effect', 'financial_execution', 'client_messaging'],
    },
    {
      code: 'A02-GM',
      business: 'A02',
      active: true,
      allowed: ['read_internal', 'draft', 'recommend', 'create_task'],
      prohibited: ['external_side_effect', 'financial_execution', 'public_publishing'],
    },
    {
      code: 'A03-GM',
      business: 'A03',
      active: true,
      allowed: ['read_internal', 'draft', 'recommend', 'create_task'],
      prohibited: ['external_side_effect', 'financial_execution'],
    },
    {
      code: 'A04-CFO',
      business: 'A04',
      active: true,
      allowed: ['read_internal', 'draft', 'recommend'],
      prohibited: ['external_side_effect', 'financial_execution', 'trading', 'money_transfer'],
    },
    {
      code: 'A05-CD',
      business: 'A05',
      active: true,
      allowed: ['read_internal', 'draft', 'recommend', 'create_task'],
      prohibited: ['external_side_effect', 'financial_execution', 'public_publishing'],
    },
    {
      code: 'A06-LD',
      business: 'A06',
      active: true,
      allowed: ['read_internal', 'draft', 'recommend', 'create_task'],
      prohibited: ['external_side_effect', 'financial_execution', 'public_publishing'],
    },
    {
      code: 'A07-AD',
      business: 'A07',
      active: true,
      allowed: ['read_internal', 'draft', 'recommend', 'create_task'],
      prohibited: ['external_side_effect', 'financial_execution'],
    },
    {
      code: 'A08-RSV',
      business: 'A08',
      active: false,
      allowed: [],
      prohibited: ['external_side_effect', 'financial_execution'],
    },
  ]
  return defs.map((d) => ({
    id: randomUUID(),
    organization_id: orgId,
    business_id: d.business ? (byCode.get(d.business)?.id ?? null) : null,
    code: d.code,
    name: d.code,
    description: null,
    authority_level: d.code === 'A08-RSV' ? 'L0' : 'L1',
    allowed_action_types: d.allowed,
    prohibited_action_types: d.prohibited,
    max_financial_authority: 0,
    currency: 'EUR',
    prompt_version: 'v1',
    active: d.active,
    status: d.active ? 'active' : 'inactive',
    created_at: now(),
    updated_at: now(),
  }))
}

export function createInMemoryStore(): JarvisStore & { state: InMemoryState } {
  const organizationId = randomUUID()
  const businesses = seedBusinesses(organizationId)
  const state: InMemoryState = {
    organizationId,
    businesses,
    agents: seedAgents(organizationId, businesses),
    tasks: [],
    projects: [],
    objectives: [],
    decisions: [],
    approvals: [],
    notifications: [],
    documents: [],
    agentRuns: [],
    toolCalls: [],
    modelUsage: [],
    auditEvents: [],
    systemEvents: [],
    dailyBriefs: [],
  }

  return {
    state,
    getOrganizationId: async () => state.organizationId,
    listBusinesses: async () => [...state.businesses],
    getBusinessByCode: async (code) => state.businesses.find((b) => b.code === code) ?? null,
    getAgentByCode: async (code) => state.agents.find((a) => a.code === code) ?? null,

    async listOpenTasks(businessId?: string) {
      return state.tasks.filter(
        (t) =>
          !['done', 'cancelled'].includes(t.status) && (!businessId || t.business_id === businessId)
      )
    },

    async createTask(input: CreateTaskInput) {
      const task: TaskRow = {
        id: randomUUID(),
        organization_id: input.organizationId,
        business_id: input.businessId,
        project_id: input.projectId ?? null,
        objective_id: null,
        title: input.title,
        description: input.description ?? null,
        status: 'todo',
        priority: input.priority ?? 'P2',
        due_date: input.dueDate ?? null,
        assigned_to: null,
        assigned_agent_id: null,
        created_by: input.createdBy ?? null,
        created_by_agent_id: input.createdByAgentId ?? null,
        completed_at: null,
        created_at: now(),
        updated_at: now(),
      }
      state.tasks.push(task)
      return task
    },

    async updateTask(id: string, patch: UpdateTaskInput) {
      const task = state.tasks.find((t) => t.id === id)
      if (!task) return null
      if (patch.title !== undefined) task.title = patch.title
      if (patch.description !== undefined) task.description = patch.description
      if (patch.status !== undefined) {
        task.status = patch.status
        if (patch.status === 'done') task.completed_at = now()
      }
      if (patch.priority !== undefined) task.priority = patch.priority
      if (patch.dueDate !== undefined) task.due_date = patch.dueDate
      task.updated_at = now()
      return task
    },

    async createProject(input: CreateProjectInput) {
      const project: ProjectRow = {
        id: randomUUID(),
        organization_id: input.organizationId,
        business_id: input.businessId,
        objective_id: input.objectiveId ?? null,
        name: input.name,
        description: input.description ?? null,
        status: 'planning',
        priority: input.priority ?? 'P2',
        start_date: null,
        due_date: null,
        created_by: input.createdBy ?? null,
        created_at: now(),
        updated_at: now(),
      }
      state.projects.push(project)
      return project
    },

    async recordDecision(input: RecordDecisionInput) {
      const decision: DecisionRow = {
        id: randomUUID(),
        organization_id: input.organizationId,
        business_id: input.businessId ?? null,
        title: input.title,
        context: input.context ?? null,
        decision: input.decision,
        rationale: input.rationale ?? null,
        status: 'recorded',
        decided_by: input.decidedBy ?? null,
        recorded_by_agent_id: input.recordedByAgentId ?? null,
        decided_at: now(),
        created_at: now(),
        updated_at: now(),
      }
      state.decisions.push(decision)
      return decision
    },

    async listPendingApprovals(businessId?: string) {
      return state.approvals.filter(
        (a) => a.status === 'pending' && (!businessId || a.business_id === businessId)
      )
    },

    // Mirrors create_approval_audited: the approval, its audit row and
    // its event appear together or not at all, and one request id can
    // only ever produce one approval. The in-memory store models these
    // invariants so tests written against it stay honest about what the
    // database will actually do.
    async createApproval(input: CreateApprovalInput) {
      if (!input.requestId) throw new Error('request_id_required')
      if (!isRequestOrigin(input.origin)) throw new Error('invalid_request_origin')
      if (input.requestedByUserId == null && input.requestedByAgentId == null) {
        throw new Error('requester_required')
      }

      const prior = state.auditEvents.find(
        (e) => e.action === 'approval.created' && e.request_id === input.requestId
      )
      if (prior) {
        const existing = state.approvals.find((a) => a.id === prior.resource_id)
        if (existing) return existing
      }

      const approval: ApprovalRow = {
        id: randomUUID(),
        organization_id: input.organizationId,
        business_id: input.businessId ?? null,
        requested_by_agent_id: input.requestedByAgentId ?? null,
        requested_by_user_id: input.requestedByUserId ?? null,
        action_type: input.actionType,
        action_payload: input.actionPayload,
        reason: input.reason ?? null,
        estimated_cost: input.estimatedCost ?? null,
        currency: input.currency ?? null,
        risk_level: input.riskLevel,
        status: 'pending',
        approved_by: null,
        approved_at: null,
        executed_at: null,
        expires_at: input.expiresAt ?? null,
        execution_result: null,
        created_at: now(),
        updated_at: now(),
      }
      state.approvals.push(approval)
      state.auditEvents.push({
        organization_id: input.organizationId,
        business_id: input.businessId ?? null,
        actor_type: input.requestedByAgentId != null ? 'agent' : 'user',
        actor_id: input.requestedByAgentId ?? input.requestedByUserId ?? null,
        action: 'approval.created',
        resource_type: 'approval',
        resource_id: approval.id,
        request_id: input.requestId,
        before_data: null,
        after_data: {
          status: 'pending',
          action_type: input.actionType,
          risk_level: input.riskLevel,
          estimated_cost: input.estimatedCost ?? null,
          payload_sha256: sha256Of(input.actionPayload),
        },
        metadata: {
          ...(input.metadata ?? {}),
          reason: input.reason ?? null,
          request_origin: input.origin,
        },
      })
      state.systemEvents.push({
        organizationId: input.organizationId,
        businessId: input.businessId ?? null,
        eventType: 'approval.requested',
        payload: { approvalId: approval.id, actionType: input.actionType },
        dedupeKey: approval.id,
      })
      return approval
    },

    // Mirrors resolve_approval: PRIME-only, optimistic concurrency, the
    // shared transition matrix, and one audit row per request id.
    async resolveApproval(input: ResolveApprovalInput) {
      if (!input.requestId) throw new Error('request_id_required')
      if (!isRequestOrigin(input.origin)) throw new Error('invalid_request_origin')

      const approval = state.approvals.find((a) => a.id === input.approvalId)
      if (!approval) throw new Error('approval_not_found')

      const action = `approval.${input.resolution}`
      const prior = state.auditEvents.find(
        (e) =>
          e.action === action &&
          e.request_id === input.requestId &&
          e.resource_id === input.approvalId
      )
      if (prior) return approval

      if (approval.status !== input.expectedStatus) throw new Error('stale_status')
      if (!approvalTransitionAllowed(approval.status, input.resolution, 'prime')) {
        throw new Error('invalid_transition')
      }

      const before = approval.status
      approval.status = input.resolution
      approval.approved_by = input.actorId
      approval.approved_at = now()
      approval.updated_at = now()
      if (input.resolution === 'modified' && input.modifiedPayload != null) {
        approval.action_payload = input.modifiedPayload
      }

      state.auditEvents.push({
        organization_id: approval.organization_id,
        business_id: approval.business_id,
        actor_type: 'user',
        actor_id: input.actorId,
        action,
        resource_type: 'approval',
        resource_id: approval.id,
        request_id: input.requestId,
        before_data: { status: before },
        after_data: { status: input.resolution },
        metadata: {
          transition: `${before}->${input.resolution}`,
          expected_status: input.expectedStatus,
          action_type: approval.action_type,
          request_origin: input.origin,
        },
      })
      state.systemEvents.push({
        organizationId: approval.organization_id,
        businessId: approval.business_id,
        eventType: action,
        payload: { approvalId: approval.id, actionType: approval.action_type },
        dedupeKey: `${approval.id}:${input.resolution}`,
      })
      return approval
    },

    async searchDocuments(query: string, businessId?: string) {
      const q = query.toLowerCase()
      return state.documents.filter(
        (d) =>
          d.status === 'active' &&
          (!businessId || d.business_id === businessId) &&
          (d.title.toLowerCase().includes(q) || (d.searchable_text ?? '').toLowerCase().includes(q))
      ) as DocumentRow[]
    },

    async getBusinessSummary(businessId: string) {
      const business = state.businesses.find((b) => b.id === businessId)
      if (!business) return null
      return {
        business,
        openTasks: state.tasks.filter(
          (t) => t.business_id === businessId && !['done', 'cancelled'].includes(t.status)
        ).length,
        activeProjects: state.projects.filter(
          (p) => p.business_id === businessId && ['planning', 'active'].includes(p.status)
        ).length,
        pendingApprovals: state.approvals.filter(
          (a) => a.business_id === businessId && a.status === 'pending'
        ).length,
        openObjectives: state.objectives.filter(
          (o) => o.business_id === businessId && ['active', 'at_risk'].includes(o.status)
        ).length,
      }
    },

    async createAgentRun(input: CreateAgentRunInput) {
      const run: AgentRunRow = {
        id: randomUUID(),
        organization_id: input.organizationId,
        business_id: input.businessId ?? null,
        agent_id: input.agentId ?? null,
        requested_by: input.requestedBy ?? null,
        request_id: input.requestId ?? null,
        intent: input.intent ?? null,
        provider: null,
        model: null,
        status: 'running',
        input_summary: input.inputSummary ?? null,
        output_summary: null,
        rationale: null,
        error: null,
        approval_id: null,
        started_at: now(),
        finished_at: null,
        created_at: now(),
        updated_at: now(),
      }
      state.agentRuns.push(run)
      return run
    },

    async updateAgentRun(id: string, patch: UpdateAgentRunInput) {
      const run = state.agentRuns.find((r) => r.id === id)
      if (!run) return
      if (patch.status !== undefined) run.status = patch.status
      if (patch.provider !== undefined) run.provider = patch.provider
      if (patch.model !== undefined) run.model = patch.model
      if (patch.outputSummary !== undefined) run.output_summary = patch.outputSummary
      if (patch.rationale !== undefined) run.rationale = patch.rationale
      if (patch.error !== undefined) run.error = patch.error
      if (patch.approvalId !== undefined) run.approval_id = patch.approvalId
      if (patch.finishedAt !== undefined) run.finished_at = patch.finishedAt
      run.updated_at = now()
    },

    async recordToolCall(input: RecordToolCallInput) {
      state.toolCalls.push(input)
    },

    async recordModelUsage(input: RecordModelUsageInput) {
      state.modelUsage.push(input)
    },

    async writeAudit(event: PersistableAuditEvent) {
      state.auditEvents.push(event)
    },

    async createNotification(input: CreateNotificationInput) {
      state.notifications.push({
        id: randomUUID(),
        organization_id: input.organizationId,
        business_id: input.businessId ?? null,
        recipient_id: input.recipientId ?? null,
        priority: input.priority,
        title: input.title,
        body: input.body ?? null,
        resource_type: input.resourceType ?? null,
        resource_id: input.resourceId ?? null,
        status: 'unread',
        read_at: null,
        created_at: now(),
        updated_at: now(),
      })
    },

    async createSystemEvent(input: CreateSystemEventInput) {
      const duplicate =
        input.dedupeKey != null &&
        state.systemEvents.some(
          (e) => e.eventType === input.eventType && e.dedupeKey === input.dedupeKey
        )
      if (!duplicate) state.systemEvents.push(input)
    },

    async getBriefData(_organizationId: string, todayIso: string): Promise<BriefData> {
      const today = todayIso.slice(0, 10)
      const sevenDaysAgo = new Date(Date.parse(todayIso) - 7 * 86400_000).toISOString()
      const objectiveBusinessIds = new Set(
        state.objectives.map((o) => o.business_id).filter((id): id is string => id != null)
      )
      return {
        pendingApprovals: state.approvals.filter((a) => a.status === 'pending'),
        overdueTasks: state.tasks.filter(
          (t) =>
            !['done', 'cancelled'].includes(t.status) && t.due_date != null && t.due_date < today
        ),
        objectivesAtRisk: state.objectives.filter((o) => o.status === 'at_risk'),
        recentlyCompletedTasks: state.tasks.filter(
          (t) => t.status === 'done' && (t.completed_at ?? '') >= sevenDaysAgo
        ),
        highPriorityNotifications: state.notifications.filter(
          (n) => ['P0', 'P1'].includes(n.priority) && n.status === 'unread'
        ),
        failedRuns: state.agentRuns.filter((r) => r.status === 'failed'),
        recentDecisions: state.decisions.filter((d) => d.decided_at >= sevenDaysAgo),
        businessesMissingData: state.businesses.filter(
          (b) => b.status === 'active' && !objectiveBusinessIds.has(b.id)
        ),
      }
    },

    async upsertDailyBrief(organizationId, briefDate, content, generatedBy) {
      const existing = state.dailyBriefs.find(
        (b) => b.organization_id === organizationId && b.brief_date === briefDate
      )
      if (existing) {
        existing.content = content
        existing.updated_at = now()
        return existing
      }
      const brief: DailyBriefRow = {
        id: randomUUID(),
        organization_id: organizationId,
        brief_date: briefDate,
        content,
        generated_by: generatedBy ?? null,
        status: 'generated',
        created_at: now(),
        updated_at: now(),
      }
      state.dailyBriefs.push(brief)
      return brief
    },

    async getDailyBrief(organizationId, briefDate) {
      return (
        state.dailyBriefs.find(
          (b) => b.organization_id === organizationId && b.brief_date === briefDate
        ) ?? null
      )
    },
  }
}
