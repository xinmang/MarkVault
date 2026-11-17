import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { AgentAnalyticsQuery } from '@shared/agent-usage-types'
import { analyticsService } from '@/services/analytics'

export function useAgentAnalytics(query: AgentAnalyticsQuery, enabled: boolean) {
  return useQuery({
    queryKey: ['agent-analytics', query],
    queryFn: ({ signal }) => analyticsService.getAgentAnalytics(query, signal),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    enabled,
  })
}
