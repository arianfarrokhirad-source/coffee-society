import type { SupabaseClient } from '@supabase/supabase-js'
import type { AgentCode, BusinessCode } from '@jarvis/shared'
import { writeAuditLog, type PersistableAuditEvent } from './audit'
import type {
  BriefData,
  BusinessSummary,
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
  ProjectRow,
  TaskRow,
} from './types'

// Production JarvisStore backed by the service-role Supabase client.
// Callers MUST have performed permission checks first — this layer
// deliberately has full access so that permission logic lives in exactly
// one place (@jarvis/permissions + the tool pipeline).

function must<T>(data: T | null, error: { message: string } | null, what: string): T {
  if (error) throw new Error(`${what}: ${error.message}`)
  if (data == null) throw new Error(`${what}: no row returned`)
  return data
}

export function createSupabaseStore(service: SupabaseClient): JarvisStore {
  return {
    async getOrganizationId() {
      const { data } = await service
        .from('organizations')
        .select('id')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      return data?.id ?? null
    },

    async listBusinesses() {
      const { data, error } = await service.from('businesses').select('*').order('code')
      return must(data, error, 'listBusinesses') as BusinessRow[]
    },

    async getBusinessByCode(code: BusinessCode) {
      const { data } = await service.from('businesses').select('*').eq('code', code).maybeSingle()
      return (data as BusinessRow | null) ?? null
    },

    async getAgentByCode(code: AgentCode) {
      const { data } = await service.from('agents').select('*').eq('code', code).maybeSingle()
      return (data as AgentRow | null) ?? null
    },

    async listOpenTasks(businessId?: string) {
      let query = service
        .from('tasks')
        .select('*')
        .not('status', 'in', '("done","cancelled")')
        .order('priority')
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(200)
      if (businessId) query = query.eq('business_id', businessId)
      const { data, error } = await query
      return must(data, error, 'listOpenTasks') as TaskRow[]
    },

    async createTask(input: CreateTaskInput) {
      const { data, error } = await service
        .from('tasks')
        .insert({
          organization_id: input.organizationId,
          business_id: input.businessId,
          title: input.title,
          description: input.description ?? null,
          priority: input.priority ?? 'P2',
          due_date: input.dueDate ?? null,
          project_id: input.projectId ?? null,
          created_by: input.createdBy ?? null,
          created_by_agent_id: input.createdByAgentId ?? null,
        })
        .select()
        .single()
      return must(data, error, 'createTask') as TaskRow
    },

    async updateTask(id: string, patch: UpdateTaskInput) {
      const { data, error } = await service
        .from('tasks')
        .update({
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
          ...(patch.dueDate !== undefined ? { due_date: patch.dueDate } : {}),
          ...(patch.status === 'done' ? { completed_at: new Date().toISOString() } : {}),
        })
        .eq('id', id)
        .select()
        .maybeSingle()
      if (error) throw new Error(`updateTask: ${error.message}`)
      return (data as TaskRow | null) ?? null
    },

    async createProject(input: CreateProjectInput) {
      const { data, error } = await service
        .from('projects')
        .insert({
          organization_id: input.organizationId,
          business_id: input.businessId,
          name: input.name,
          description: input.description ?? null,
          priority: input.priority ?? 'P2',
          objective_id: input.objectiveId ?? null,
          created_by: input.createdBy ?? null,
        })
        .select()
        .single()
      return must(data, error, 'createProject') as ProjectRow
    },

    async recordDecision(input: RecordDecisionInput) {
      const { data, error } = await service
        .from('decisions')
        .insert({
          organization_id: input.organizationId,
          business_id: input.businessId ?? null,
          title: input.title,
          decision: input.decision,
          context: input.context ?? null,
          rationale: input.rationale ?? null,
          decided_by: input.decidedBy ?? null,
          recorded_by_agent_id: input.recordedByAgentId ?? null,
        })
        .select()
        .single()
      return must(data, error, 'recordDecision') as DecisionRow
    },

    async listPendingApprovals(businessId?: string) {
      let query = service
        .from('approvals')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(100)
      if (businessId) query = query.eq('business_id', businessId)
      const { data, error } = await query
      return must(data, error, 'listPendingApprovals') as ApprovalRow[]
    },

    async createApproval(input: CreateApprovalInput) {
      const { data, error } = await service
        .from('approvals')
        .insert({
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
          expires_at: input.expiresAt ?? null,
        })
        .select()
        .single()
      return must(data, error, 'createApproval') as ApprovalRow
    },

    async searchDocuments(query: string, businessId?: string) {
      let q = service
        .from('documents')
        .select('*')
        .eq('status', 'active')
        .textSearch('searchable_text', query, { type: 'websearch', config: 'english' })
        .limit(25)
      if (businessId) q = q.eq('business_id', businessId)
      const { data, error } = await q
      if (error) {
        // Fall back to title ILIKE when websearch syntax rejects the input.
        let fallback = service
          .from('documents')
          .select('*')
          .eq('status', 'active')
          .ilike('title', `%${query.replace(/[%_]/g, '')}%`)
          .limit(25)
        if (businessId) fallback = fallback.eq('business_id', businessId)
        const second = await fallback
        return must(second.data, second.error, 'searchDocuments') as DocumentRow[]
      }
      return (data ?? []) as DocumentRow[]
    },

    async getBusinessSummary(businessId: string) {
      const { data: business } = await service
        .from('businesses')
        .select('*')
        .eq('id', businessId)
        .maybeSingle()
      if (!business) return null
      const [tasks, projects, approvals, objectives] = await Promise.all([
        service
          .from('tasks')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', businessId)
          .not('status', 'in', '("done","cancelled")'),
        service
          .from('projects')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', businessId)
          .in('status', ['planning', 'active']),
        service
          .from('approvals')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', businessId)
          .eq('status', 'pending'),
        service
          .from('objectives')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', businessId)
          .in('status', ['active', 'at_risk']),
      ])
      const summary: BusinessSummary = {
        business: business as BusinessRow,
        openTasks: tasks.count ?? 0,
        activeProjects: projects.count ?? 0,
        pendingApprovals: approvals.count ?? 0,
        openObjectives: objectives.count ?? 0,
      }
      return summary
    },

    async createAgentRun(input: CreateAgentRunInput) {
      const { data, error } = await service
        .from('agent_runs')
        .insert({
          organization_id: input.organizationId,
          business_id: input.businessId ?? null,
          agent_id: input.agentId ?? null,
          requested_by: input.requestedBy ?? null,
          request_id: input.requestId ?? null,
          intent: input.intent ?? null,
          input_summary: input.inputSummary ?? null,
          status: 'running',
          started_at: new Date().toISOString(),
        })
        .select()
        .single()
      return must(data, error, 'createAgentRun') as AgentRunRow
    },

    async updateAgentRun(id: string, patch: UpdateAgentRunInput) {
      const { error } = await service
        .from('agent_runs')
        .update({
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
          ...(patch.model !== undefined ? { model: patch.model } : {}),
          ...(patch.outputSummary !== undefined ? { output_summary: patch.outputSummary } : {}),
          ...(patch.rationale !== undefined ? { rationale: patch.rationale } : {}),
          ...(patch.error !== undefined ? { error: patch.error } : {}),
          ...(patch.approvalId !== undefined ? { approval_id: patch.approvalId } : {}),
          ...(patch.startedAt !== undefined ? { started_at: patch.startedAt } : {}),
          ...(patch.finishedAt !== undefined ? { finished_at: patch.finishedAt } : {}),
        })
        .eq('id', id)
      if (error) throw new Error(`updateAgentRun: ${error.message}`)
    },

    async recordToolCall(input: RecordToolCallInput) {
      const { error } = await service.from('tool_calls').insert({
        organization_id: input.organizationId,
        run_id: input.runId ?? null,
        business_id: input.businessId ?? null,
        tool_name: input.toolName,
        arguments: input.arguments,
        status: input.status,
        denial_reason: input.denialReason ?? null,
        result_summary: input.resultSummary ?? null,
        error: input.error ?? null,
        duration_ms: input.durationMs ?? null,
      })
      if (error) throw new Error(`recordToolCall: ${error.message}`)
    },

    async recordModelUsage(input: RecordModelUsageInput) {
      const { error } = await service.from('model_usage').insert({
        organization_id: input.organizationId,
        run_id: input.runId ?? null,
        provider: input.provider,
        model: input.model,
        input_tokens: input.inputTokens ?? null,
        output_tokens: input.outputTokens ?? null,
        latency_ms: input.latencyMs ?? null,
        success: input.success,
      })
      if (error) throw new Error(`recordModelUsage: ${error.message}`)
    },

    async writeAudit(event: PersistableAuditEvent) {
      await writeAuditLog(service, event)
    },

    async createNotification(input: CreateNotificationInput) {
      const { error } = await service.from('notifications').insert({
        organization_id: input.organizationId,
        business_id: input.businessId ?? null,
        recipient_id: input.recipientId ?? null,
        priority: input.priority,
        title: input.title,
        body: input.body ?? null,
        resource_type: input.resourceType ?? null,
        resource_id: input.resourceId ?? null,
      })
      if (error) throw new Error(`createNotification: ${error.message}`)
    },

    async createSystemEvent(input: CreateSystemEventInput) {
      const { error } = await service.from('system_events').insert({
        organization_id: input.organizationId,
        business_id: input.businessId ?? null,
        event_type: input.eventType,
        payload: input.payload ?? {},
        dedupe_key: input.dedupeKey ?? null,
      })
      // Unique violation on dedupe_key = already recorded; idempotent no-op.
      if (error && !error.message.includes('duplicate key')) {
        throw new Error(`createSystemEvent: ${error.message}`)
      }
    },

    async getBriefData(organizationId: string, todayIso: string): Promise<BriefData> {
      const sevenDaysAgo = new Date(Date.parse(todayIso) - 7 * 86400_000).toISOString()
      const [
        approvals,
        overdue,
        atRisk,
        completed,
        notifications,
        failedRuns,
        decisions,
        businesses,
        objectives,
      ] = await Promise.all([
        service
          .from('approvals')
          .select('*')
          .eq('organization_id', organizationId)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(50),
        service
          .from('tasks')
          .select('*')
          .eq('organization_id', organizationId)
          .not('status', 'in', '("done","cancelled")')
          .lt('due_date', todayIso.slice(0, 10))
          .limit(50),
        service
          .from('objectives')
          .select('*')
          .eq('organization_id', organizationId)
          .eq('status', 'at_risk')
          .limit(50),
        service
          .from('tasks')
          .select('*')
          .eq('organization_id', organizationId)
          .eq('status', 'done')
          .gte('completed_at', sevenDaysAgo)
          .limit(50),
        service
          .from('notifications')
          .select('*')
          .eq('organization_id', organizationId)
          .in('priority', ['P0', 'P1'])
          .eq('status', 'unread')
          .limit(50),
        service
          .from('agent_runs')
          .select('*')
          .eq('organization_id', organizationId)
          .eq('status', 'failed')
          .gte('created_at', sevenDaysAgo)
          .limit(50),
        service
          .from('decisions')
          .select('*')
          .eq('organization_id', organizationId)
          .gte('decided_at', sevenDaysAgo)
          .order('decided_at', { ascending: false })
          .limit(20),
        service
          .from('businesses')
          .select('*')
          .eq('organization_id', organizationId)
          .eq('status', 'active'),
        service.from('objectives').select('business_id').eq('organization_id', organizationId),
      ])

      const objectiveBusinessIds = new Set(
        ((objectives.data ?? []) as { business_id: string | null }[])
          .map((o) => o.business_id)
          .filter((id): id is string => id != null)
      )
      const businessesMissingData = ((businesses.data ?? []) as BusinessRow[]).filter(
        (b) => !objectiveBusinessIds.has(b.id)
      )

      return {
        pendingApprovals: (approvals.data ?? []) as BriefData['pendingApprovals'],
        overdueTasks: (overdue.data ?? []) as BriefData['overdueTasks'],
        objectivesAtRisk: (atRisk.data ?? []) as BriefData['objectivesAtRisk'],
        recentlyCompletedTasks: (completed.data ?? []) as BriefData['recentlyCompletedTasks'],
        highPriorityNotifications: (notifications.data ??
          []) as BriefData['highPriorityNotifications'],
        failedRuns: (failedRuns.data ?? []) as BriefData['failedRuns'],
        recentDecisions: (decisions.data ?? []) as BriefData['recentDecisions'],
        businessesMissingData,
      }
    },

    async upsertDailyBrief(organizationId, briefDate, content, generatedBy) {
      const { data, error } = await service
        .from('daily_briefs')
        .upsert(
          {
            organization_id: organizationId,
            brief_date: briefDate,
            content,
            generated_by: generatedBy ?? null,
            status: 'generated',
          },
          { onConflict: 'organization_id,brief_date' }
        )
        .select()
        .single()
      return must(data, error, 'upsertDailyBrief') as DailyBriefRow
    },

    async getDailyBrief(organizationId, briefDate) {
      const { data } = await service
        .from('daily_briefs')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('brief_date', briefDate)
        .maybeSingle()
      return (data as DailyBriefRow | null) ?? null
    },
  }
}
