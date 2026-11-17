/**
 * 点击统计（GET /analytics）的请求与响应契约。
 *
 * 所有日期均为用户所在时区（tz）下的自然日，格式 YYYY-MM-DD；
 * 时间戳字段（last_clicked_at）为 UTC ISO 字符串。
 */

export type AnalyticsGranularity = 'day' | 'week' | 'month'

export interface AnalyticsQuery {
  /** 起始日期（含）；省略表示“全部时间”，服务端从最早的点击记录开始 */
  startDate?: string
  /** 结束日期（含）；省略为 tz 时区下的今天 */
  endDate?: string
  /** IANA 时区名，例如 Asia/Shanghai；省略为 UTC */
  tz?: string
  granularity?: AnalyticsGranularity
  /** 排行榜条数，1–50，默认 10 */
  limit?: number
  /** 只统计当前带有该标签的书签点击，标签点击只统计该标签 */
  tagId?: string
  /** 只统计该书签的点击；此时不返回标签点击数据 */
  bookmarkId?: string
}

export interface AnalyticsRange {
  start_date: string
  end_date: string
  tz: string
  granularity: AnalyticsGranularity
  /** 统计区间包含的自然日天数 */
  days: number
  /** 请求未指定 start_date，区间从最早点击记录开始 */
  all_time: boolean
}

export interface AnalyticsTrendPoint {
  /** day: YYYY-MM-DD；week: 该周周一 YYYY-MM-DD；month: YYYY-MM */
  bucket: string
  /** 该桶在统计区间内的第一天与最后一天（已按区间裁剪） */
  start_date: string
  end_date: string
  bookmark_clicks: number
  tag_clicks: number
}

export interface AnalyticsPeakDay {
  date: string
  bookmark_clicks: number
  tag_clicks: number
}

export interface AnalyticsSummary {
  bookmark_clicks: number
  tag_clicks: number
  /** 区间内被点击过的不同书签数 */
  bookmarks_clicked: number
  /** 区间内被点击过的不同标签数 */
  tags_clicked: number
  /** 至少有一次书签或标签点击的天数 */
  active_days: number
  /** 书签与标签点击合计最多的一天；没有点击时为 null */
  peak_day: AnalyticsPeakDay | null
  /** 紧邻当前区间之前、等长区间的对比数据 */
  previous: {
    start_date: string
    end_date: string
    bookmark_clicks: number
    tag_clicks: number
  }
}

export interface AnalyticsTagRef {
  id: string
  name: string
  color: string | null
}

export interface AnalyticsBookmarkRank {
  id: string
  title: string
  url: string
  favicon: string | null
  clicks: number
  last_clicked_at: string
  tags: AnalyticsTagRef[]
}

export interface AnalyticsTagRank {
  id: string
  name: string
  color: string | null
  icon: string | null
  clicks: number
  last_clicked_at: string
  /** 该标签当前关联的未删除书签数 */
  bookmark_count: number
}

export interface AnalyticsDomainRank {
  domain: string
  clicks: number
  /** 区间内该域名下被点击过的不同书签数 */
  bookmarks: number
}

export interface AnalyticsFilters {
  tag: AnalyticsTagRef | null
  bookmark: { id: string; title: string; url: string } | null
}

export interface AnalyticsResponse {
  range: AnalyticsRange
  filters: AnalyticsFilters
  /** 最早一次点击（书签或标签）所在的日期；没有任何点击时为 null */
  first_event_date: string | null
  summary: AnalyticsSummary
  /** 按 granularity 分桶、覆盖整个区间并以 0 补齐 */
  trend: AnalyticsTrendPoint[]
  top_bookmarks: AnalyticsBookmarkRank[]
  top_tags: AnalyticsTagRank[]
  top_domains: AnalyticsDomainRank[]
  /** 7 行（0=周日 … 6=周六）× 24 列（0–23 时）的书签点击次数 */
  heatmap: number[][]
  /** API Key 缺少 tags.read 时为 false，此时标签相关字段为空 */
  tags_available: boolean
}
