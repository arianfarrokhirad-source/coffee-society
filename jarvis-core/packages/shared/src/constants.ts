// Canonical business + agent registry constants. The database seed is the
// source of truth at runtime; these constants exist for type-safety and
// deterministic routing/classification.

export const BUSINESS_CODES = [
  'A00',
  'A01',
  'A02',
  'A03',
  'A04',
  'A05',
  'A06',
  'A07',
  'A08',
] as const
export type BusinessCode = (typeof BUSINESS_CODES)[number]

export const BUSINESS_NAMES: Record<BusinessCode, string> = {
  A00: 'ATLAS',
  A01: 'FORGE',
  A02: 'SIGNAL',
  A03: 'VECTOR',
  A04: 'ORACLE',
  A05: 'TEMPO',
  A06: 'ECHO',
  A07: 'ACADEMY',
  A08: 'VOID',
}

export const AGENT_CODES = [
  'JVS-00',
  'A00-GM',
  'A01-GM',
  'A02-GM',
  'A03-GM',
  'A04-CFO',
  'A05-CD',
  'A06-LD',
  'A07-AD',
  'A08-RSV',
] as const
export type AgentCode = (typeof AGENT_CODES)[number]

export const BUSINESS_AGENT: Record<BusinessCode, AgentCode> = {
  A00: 'A00-GM',
  A01: 'A01-GM',
  A02: 'A02-GM',
  A03: 'A03-GM',
  A04: 'A04-CFO',
  A05: 'A05-CD',
  A06: 'A06-LD',
  A07: 'A07-AD',
  A08: 'A08-RSV',
}

export const AUTHORITY_LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'] as const
export type AuthorityLevel = (typeof AUTHORITY_LEVELS)[number]

export const ROLE_KEYS = [
  'prime',
  'executive',
  'business_manager',
  'employee',
  'contractor',
  'client',
  'agent',
] as const
export type RoleKey = (typeof ROLE_KEYS)[number]

export const PRIORITY_LEVELS = ['P0', 'P1', 'P2', 'P3'] as const
export type PriorityLevel = (typeof PRIORITY_LEVELS)[number]

export const RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const
export type RiskLevel = (typeof RISK_LEVELS)[number]

export const APPROVAL_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'modified',
  'executed',
  'failed',
  'expired',
  'cancelled',
] as const
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number]

export const AI_PROVIDERS = ['anthropic', 'openai'] as const
export type AIProviderName = (typeof AI_PROVIDERS)[number]
