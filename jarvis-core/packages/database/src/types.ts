import type {
  AgentCode,
  AIProviderName,
  ApprovalStatus,
  AuthorityLevel,
  BusinessCode,
  PriorityLevel,
  RiskLevel,
  RoleKey,
} from '@jarvis/shared'

// Typed rows for the tables the application reads/writes. Kept by hand
// in Phase 1 (no codegen dependency); regenerate with the Supabase CLI
// later if drift becomes a problem.

export interface OrganizationRow {
  id: string
  name: string
  slug: string
  status: 'active' | 'archived'
  created_at: string
  updated_at: string
}

export interface BusinessRow {
  id: string
  organization_id: string
  code: BusinessCode
  name: string
  description: string | null
  status: 'active' | 'dormant' | 'archived'
  agents_enabled: boolean
  created_at: string
  updated_at: string
}

export interface ProfileRow {
  id: string
  display_name: string | null
  email: string | null
  created_at: string
  updated_at: string
}

export interface RoleRow {
  id: string
  key: RoleKey
  name: string
  description: string | null
  default_authority_level: AuthorityLevel
}

export interface MembershipRow {
  id: string
  organization_id: string
  business_id: string | null
  profile_id: string
  role_id: string
  authority_level: AuthorityLevel
  status: 'active' | 'suspended' | 'revoked'
  created_at: string
  updated_at: string
}

export interface AgentRow {
  id: string
  organization_id: string
  business_id: string | null
  code: AgentCode
  name: string
  description: string | null
  authority_level: AuthorityLevel
  allowed_action_types: string[]
  prohibited_action_types: string[]
  max_financial_authority: number
  currency: string
  prompt_version: string
  active: boolean
  status: 'active' | 'inactive' | 'retired'
  created_at: string
  updated_at: string
}

export interface ObjectiveRow {
  id: string
  organization_id: string
  business_id: string | null
  title: string
  description: string | null
  status: 'draft' | 'active' | 'at_risk' | 'completed' | 'cancelled'
  priority: PriorityLevel
  target_date: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface ProjectRow {
  id: string
  organization_id: string
  business_id: string
  objective_id: string | null
  name: string
  description: string | null
  status: 'planning' | 'active' | 'on_hold' | 'completed' | 'cancelled'
  priority: PriorityLevel
  start_date: string | null
  due_date: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface TaskRow {
  id: string
  organization_id: string
  business_id: string
  project_id: string | null
  objective_id: string | null
  title: string
  description: string | null
  status: 'todo' | 'in_progress' | 'blocked' | 'review' | 'done' | 'cancelled'
  priority: PriorityLevel
  due_date: string | null
  assigned_to: string | null
  assigned_agent_id: string | null
  created_by: string | null
  created_by_agent_id: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface DecisionRow {
  id: string
  organization_id: string
  business_id: string | null
  title: string
  context: string | null
  decision: string
  rationale: string | null
  status: 'proposed' | 'recorded' | 'superseded' | 'reversed'
  decided_by: string | null
  recorded_by_agent_id: string | null
  decided_at: string
  created_at: string
  updated_at: string
}

export interface ApprovalRow {
  id: string
  organization_id: string
  business_id: string | null
  requested_by_agent_id: string | null
  requested_by_user_id: string | null
  action_type: string
  action_payload: Record<string, unknown>
  reason: string | null
  estimated_cost: number | null
  currency: string | null
  risk_level: RiskLevel
  status: ApprovalStatus
  approved_by: string | null
  approved_at: string | null
  executed_at: string | null
  expires_at: string | null
  execution_result: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export interface NotificationRow {
  id: string
  organization_id: string
  business_id: string | null
  recipient_id: string | null
  priority: PriorityLevel
  title: string
  body: string | null
  resource_type: string | null
  resource_id: string | null
  status: 'unread' | 'read' | 'archived'
  read_at: string | null
  created_at: string
  updated_at: string
}

export interface DocumentRow {
  id: string
  organization_id: string
  business_id: string | null
  title: string
  classification: 'public' | 'internal' | 'confidential' | 'restricted'
  approval_status: 'draft' | 'pending_review' | 'approved' | 'archived'
  owner_id: string | null
  storage_bucket: string
  storage_path: string | null
  mime_type: string | null
  size_bytes: number | null
  current_version: number
  searchable_text: string | null
  status: 'active' | 'archived' | 'deleted'
  uploaded_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface AgentRunRow {
  id: string
  organization_id: string
  business_id: string | null
  agent_id: string | null
  requested_by: string | null
  request_id: string | null
  intent: string | null
  provider: AIProviderName | 'none' | null
  model: string | null
  status: 'pending' | 'running' | 'completed' | 'failed' | 'requires_approval'
  input_summary: string | null
  output_summary: string | null
  rationale: string | null
  error: string | null
  approval_id: string | null
  started_at: string | null
  finished_at: string | null
  created_at: string
  updated_at: string
}

export interface ToolCallRow {
  id: string
  organization_id: string
  run_id: string | null
  business_id: string | null
  tool_name: string
  arguments: Record<string, unknown>
  status: 'requested' | 'denied' | 'executed' | 'failed'
  denial_reason: string | null
  result_summary: string | null
  error: string | null
  duration_ms: number | null
  created_at: string
}

export interface DailyBriefRow {
  id: string
  organization_id: string
  brief_date: string
  content: Record<string, unknown>
  generated_by: string | null
  status: 'generated' | 'failed'
  created_at: string
  updated_at: string
}

export interface SystemEventRow {
  id: string
  organization_id: string
  business_id: string | null
  event_type: string
  payload: Record<string, unknown>
  dedupe_key: string | null
  status: 'pending' | 'processing' | 'completed' | 'failed'
  attempts: number
  last_error: string | null
  processed_at: string | null
  created_at: string
  updated_at: string
}
