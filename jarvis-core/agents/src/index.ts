import type { AgentCode, BusinessCode } from '@jarvis/shared'
import { BUSINESS_NAMES } from '@jarvis/shared'
import { MASTER_CONSTITUTION } from './constitution'
import { roleCard as jvs } from '../jvs/role-card'
import { roleCard as atlas } from '../atlas/role-card'
import { roleCard as forge } from '../forge/role-card'
import { roleCard as signal } from '../signal/role-card'
import { roleCard as vector } from '../vector/role-card'
import { roleCard as oracle } from '../oracle/role-card'
import { roleCard as tempo } from '../tempo/role-card'
import { roleCard as echo } from '../echo/role-card'
import { roleCard as academy } from '../academy/role-card'
import { roleCard as voidCard } from '../void/role-card'

export { MASTER_CONSTITUTION, CONSTITUTION_VERSION } from './constitution'

export const AGENT_ROLE_CARDS: Record<AgentCode, string> = {
  'JVS-00': jvs,
  'A00-GM': atlas,
  'A01-GM': forge,
  'A02-GM': signal,
  'A03-GM': vector,
  'A04-CFO': oracle,
  'A05-CD': tempo,
  'A06-LD': echo,
  'A07-AD': academy,
  'A08-RSV': voidCard,
}

export interface PromptLayers {
  agentCode: AgentCode
  businessCode: BusinessCode | null
  businessContext?: string
  authorizedData?: string[]
  taskPacket: string
}

/**
 * Composable prompt system (section 13):
 *   Master Constitution + Agent Role Card + Business Context
 *   + Authorized Retrieved Data + Current Task Packet.
 * The constitution appears exactly once; nothing is duplicated per route.
 */
export function composePrompt(layers: PromptLayers): { system: string; user: string } {
  const roleCard = AGENT_ROLE_CARDS[layers.agentCode]
  const businessLine = layers.businessCode
    ? `BUSINESS CONTEXT\nBusiness: ${layers.businessCode} ${BUSINESS_NAMES[layers.businessCode]}` +
      (layers.businessContext ? `\n${layers.businessContext}` : '')
    : 'BUSINESS CONTEXT\nOrganization-wide request.'

  const system = [MASTER_CONSTITUTION, roleCard, businessLine].join('\n\n---\n\n')

  const dataBlock =
    layers.authorizedData && layers.authorizedData.length > 0
      ? `AUTHORIZED RETRIEVED DATA\n${layers.authorizedData.join('\n')}\n\n`
      : ''

  return { system, user: `${dataBlock}CURRENT TASK PACKET\n${layers.taskPacket}` }
}
