/** Agent 使用统计契约：时间区间按用户时区的自然日计算。 */
export type AgentUsageSource = 'chat' | 'agent_api' | 'mcp'
export type AgentUsageSourceFilter = AgentUsageSource | 'all'

export interface AgentAnalyticsQuery {
  startDate?: string
  endDate?: string
  tz?: string
  granularity?: 'day' | 'week' | 'month'
  limit?: number
  source?: AgentUsageSourceFilter
}

export interface AgentUsageMetrics {
  calls: number
  successful_calls: number
  failed_calls: number
  /** 没有调用时为 null，不能显示为 0% 或 100%。 */
  success_rate: number | null
  avg_duration_ms: number | null
}

export interface AgentUsageTrendPoint {
  bucket: string
  start_date: string
  end_date: string
  chat: number
  agent_api: number
  mcp: number
}

export interface AgentAnalyticsResponse {
  range: {
    start_date: string
    end_date: string
    tz: string
    granularity: 'day' | 'week' | 'month'
    days: number
    all_time: boolean
  }
  first_event_date: string | null
  summary: AgentUsageMetrics & { tool_calls: number; active_days: number }
  sources: (AgentUsageMetrics & { source: AgentUsageSource })[]
  trend: AgentUsageTrendPoint[]
  top_operations: (AgentUsageMetrics & { source: AgentUsageSource; operation: string })[]
}
