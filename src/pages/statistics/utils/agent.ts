import type { AgentUsageSource } from '@shared/agent-usage-types'

export const AGENT_SOURCES: readonly AgentUsageSource[] = ['chat', 'agent_api', 'mcp']
export const AGENT_COLORS: Record<AgentUsageSource, string> = {
  chat: 'var(--viz-series-1)',
  agent_api: 'var(--viz-series-2)',
  mcp: 'var(--viz-series-3)',
}
