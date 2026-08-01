import type { AgentCode, BusinessCode, PriorityLevel, RiskLevel } from '@jarvis/shared'
import type { PersistableAuditEvent } from './audit'
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

// ---------------------------------------------------------------------
// JarvisStore: the single data-access seam used by the orchestrator,
// tools and reporting. Two implementations:
//   - SupabaseStore (service role; production)
//   - InMemoryStore (tests, offline development)
// Keeping this seam narrow is what makes the security-critical logic
// unit-testable without a live database.
// ---------------------------------------------------------------------

export interface CreateTaskInput {
  organizationId: string
  businessId: string
  title: string
  description?: string | null
  priority?: PriorityLevel
  dueDate?: string | null
  projectId?: string | null
  createdBy?: string | null
  createdByAgentId?: string | null
}

export interface UpdateTaskInput {
  title?: string
  description?: string | null
  status?: TaskRow['status']
  priority?: PriorityLevel
  dueDate?: string | null
}

export interface CreateProjectInput {
  organizationId: string
  businessId: string
  name: string
  description?: string | null
  priority?: PriorityLevel
  objectiveId?: string | null
  createdBy?: string | null
}

export interface RecordDecisionInput {
  organizationId: string
  businessId?: string | null
  title: string
  decision: string
  context?: string | null
  rationale?: string | null
  decidedBy?: string | null
  recordedByAgentId?: string | null
}

export interface CreateApprovalInput {
  organizationId: string
  businessId?: string | null
  requestedByAgentId?: string | null
  requestedByUserId?: string | null
  actionType: string
  actionPayload: Record<string, unknown>
  reason?: string | null
  estimatedCost?: number | null
  currency?: string | null
  riskLevel: RiskLevel
  expiresAt?: string | null
}

export interface CreateAgentRunInput {
  organizationId: string
  businessId?: string | null
  agentId?: string | null
  requestedBy?: string | null
  requestId?: string | null
  intent?: string | null
  inputSummary?: string | null
}

export interface UpdateAgentRunInput {
  status?: AgentRunRow['status']
  provider?: 'anthropic' | 'openai' | 'none' | null
  model?: string | null
  outputSummary?: string | null
  rationale?: string | null
  error?: string | null
  approvalId?: string | null
  startedAt?: string | null
  finishedAt?: string | null
}

export interface RecordToolCallInput {
  organizationId: string
  runId?: string | null
  businessId?: string | null
  toolName: string
  arguments: Record<string, unknown>
  status: 'requested' | 'denied' | 'executed' | 'failed'
  denialReason?: string | null
  resultSummary?: string | null
  error?: string | null
  durationMs?: number | null
}

export interface RecordModelUsageInput {
  organizationId: string
  runId?: string | null
  provider: 'anthropic' | 'openai'
  model: string
  inputTokens?: number | null
  outputTokens?: number | null
  latencyMs?: number | null
  success: boolean
}

export interface CreateNotificationInput {
  organizationId: string
  businessId?: string | null
  recipientId?: string | null
  priority: PriorityLevel
  title: string
  body?: string | null
  resourceType?: string | null
  resourceId?: string | null
}

export interface CreateSystemEventInput {
  organizationId: string
  businessId?: string | null
  eventType: string
  payload?: Record<string, unknown>
  dedupeKey?: string | null
}

export interface BusinessSummary {
  business: BusinessRow
  openTasks: number
  activeProjects: number
  pendingApprovals: number
  openObjectives: number
}

export interface BriefData {
  pendingApprovals: ApprovalRow[]
  overdueTasks: TaskRow[]
  objectivesAtRisk: ObjectiveRow[]
  recentlyCompletedTasks: TaskRow[]
  highPriorityNotifications: NotificationRow[]
  failedRuns: AgentRunRow[]
  recentDecisions: DecisionRow[]
  businessesMissingData: BusinessRow[]
}

export interface JarvisStore {
  getOrganizationId(): Promise<string | null>
  listBusinesses(): Promise<BusinessRow[]>
  getBusinessByCode(code: BusinessCode): Promise<BusinessRow | null>
  getAgentByCode(code: AgentCode): Promise<AgentRow | null>

  listOpenTasks(businessId?: string): Promise<TaskRow[]>
  createTask(input: CreateTaskInput): Promise<TaskRow>
  updateTask(id: string, patch: UpdateTaskInput): Promise<TaskRow | null>
  createProject(input: CreateProjectInput): Promise<ProjectRow>
  recordDecision(input: RecordDecisionInput): Promise<DecisionRow>

  listPendingApprovals(businessId?: string): Promise<ApprovalRow[]>
  createApproval(input: CreateApprovalInput): Promise<ApprovalRow>

  searchDocuments(query: string, businessId?: string): Promise<DocumentRow[]>
  getBusinessSummary(businessId: string): Promise<BusinessSummary | null>

  createAgentRun(input: CreateAgentRunInput): Promise<AgentRunRow>
  updateAgentRun(id: string, patch: UpdateAgentRunInput): Promise<void>
  recordToolCall(input: RecordToolCallInput): Promise<void>
  recordModelUsage(input: RecordModelUsageInput): Promise<void>
  writeAudit(event: PersistableAuditEvent): Promise<void>
  createNotification(input: CreateNotificationInput): Promise<void>
  createSystemEvent(input: CreateSystemEventInput): Promise<void>

  getBriefData(organizationId: string, todayIso: string): Promise<BriefData>
  upsertDailyBrief(
    organizationId: string,
    briefDate: string,
    content: Record<string, unknown>,
    generatedBy?: string | null
  ): Promise<DailyBriefRow>
  getDailyBrief(organizationId: string, briefDate: string): Promise<DailyBriefRow | null>
}
