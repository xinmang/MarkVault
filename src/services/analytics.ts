import { apiClient } from '@/lib/api-client'
import type { AnalyticsQuery, AnalyticsResponse } from '@/lib/types'
import { assertData } from './index'
import type { AgentAnalyticsQuery, AgentAnalyticsResponse } from '@shared/agent-usage-types'

function rangeParams(query: AgentAnalyticsQuery) {
  const params = new URLSearchParams()
  if (query.startDate) params.set('start_date', query.startDate)
  if (query.endDate) params.set('end_date', query.endDate)
  if (query.tz) params.set('tz', query.tz)
  if (query.granularity) params.set('granularity', query.granularity)
  if (query.limit) params.set('limit', String(query.limit))
  return params
}

export const analyticsService = {
  /**
   * 获取指定区间的书签与标签点击统计
   */
  async getClickAnalytics(query: AnalyticsQuery, signal?: AbortSignal) {
    const params = rangeParams(query)
    if (query.tagId) params.set('tag_id', query.tagId)
    if (query.bookmarkId) params.set('bookmark_id', query.bookmarkId)

    const search = params.toString()
    const response = await apiClient.get<AnalyticsResponse>(
      search ? `/analytics?${search}` : '/analytics',
      { signal }
    )
    return assertData(response.data, 'GET /analytics')
  },

  async getAgentAnalytics(query: AgentAnalyticsQuery, signal?: AbortSignal) {
    const params = rangeParams(query)
    if (query.source) params.set('source', query.source)
    const response = await apiClient.get<AgentAnalyticsResponse>(`/analytics/agent?${params}`, {
      signal,
    })
    return assertData(response.data, 'GET /analytics/agent')
  },
}
