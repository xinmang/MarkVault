import type { AnalyticsTrendPoint } from '@/lib/types'

/** 排行列的三个维度 */
export type RankTab = 'bookmarks' | 'tags' | 'domains'

/** 趋势图可切换的序列组合 */
export type SeriesSelection = 'all' | 'bookmark' | 'tag'

/** 趋势图的绘制样式：默认柱状，可切换折线 */
export type ChartStyle = 'bar' | 'line'

/** 合法的序列组合，用于校验 URL 之外的入口 */
export const SERIES_SELECTIONS: readonly SeriesSelection[] = ['all', 'bookmark', 'tag']

/** 排行条的相对宽度（百分比），最大值为 0 时返回 0，避免除零 */
export function ratioPercent(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0
  return Math.min(100, Math.max(0, (value / max) * 100))
}

/** 区间描述所需的输入 */
export interface RangeDescriptionInput {
  start: string | null
  end: string
  days: number | null
  tz: string
  allTime: boolean
}

export type RangeDescriptionKey = 'description' | 'descriptionAllTime' | 'descriptionUnknown'

/**
 * 选择区间描述文案：天数未知（全部时间且服务端还没返回）时退化为简短版本。
 */
export function pickRangeDescriptionKey(input: {
  days: number | null
  allTime: boolean
}): RangeDescriptionKey {
  if (input.days === null || !Number.isFinite(input.days)) return 'descriptionUnknown'
  return input.allTime ? 'descriptionAllTime' : 'description'
}

export interface PeakBucket {
  point: AnalyticsTrendPoint
  /** 可见序列的合计值 */
  value: number
}

/**
 * 找出趋势里的峰值桶。只统计当前可见的序列；没有任何点击时返回 null。
 */
export function pickPeakBucket(
  points: AnalyticsTrendPoint[],
  includeBookmark: boolean,
  includeTag: boolean
): PeakBucket | null {
  let best: PeakBucket | null = null
  for (const point of points) {
    const bookmark = includeBookmark ? point.bookmark_clicks : 0
    const tag = includeTag ? point.tag_clicks : 0
    const value = bookmark + tag
    if (value > 0 && (!best || value > best.value)) best = { point, value }
  }
  return best
}
