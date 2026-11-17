import type { AnalyticsGranularity } from '@/lib/types'
import { parseDateKey } from './date'

/** 小数值保留千分位，大数值使用紧凑格式（1,284 / 12.9K / 1.3万） */
export function formatCompactNumber(value: number, locale: string): string {
  if (!Number.isFinite(value)) return '0'
  const absolute = Math.abs(value)
  try {
    if (absolute < 10_000) {
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)
    }
    return new Intl.NumberFormat(locale, {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value)
  } catch {
    return String(Math.round(value))
  }
}

export type DeltaDirection = 'up' | 'down' | 'flat' | 'none'

export interface ClickDelta {
  direction: DeltaDirection
  /** 绝对百分比（整数）；没有可比较的上一周期时为 null */
  percent: number | null
}

/** 与上一周期比较。上一周期为 0 时视为“无数据”，不做百分比计算 */
export function computeClickDelta(current: number, previous: number): ClickDelta {
  if (!Number.isFinite(previous) || previous <= 0) {
    return { direction: 'none', percent: null }
  }
  const safeCurrent = Number.isFinite(current) ? current : 0
  const diff = safeCurrent - previous
  if (diff === 0) return { direction: 'flat', percent: 0 }
  return {
    direction: diff > 0 ? 'up' : 'down',
    percent: Math.round((Math.abs(diff) / previous) * 100),
  }
}

/** 占比（整数百分比）；总量为 0 时返回 null，避免除零 */
export function computeSharePercent(part: number, total: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return null
  return Math.round((part / total) * 100)
}

function parseBucket(bucket: string, granularity: AnalyticsGranularity): Date | null {
  if (granularity === 'month') {
    return parseDateKey(/^\d{4}-\d{2}$/.test(bucket) ? `${bucket}-01` : bucket)
  }
  return parseDateKey(bucket)
}

/** 图表轴上的短标签：day/week -> 10月12日，month -> 2026年10月 */
export function formatBucketLabel(
  bucket: string,
  granularity: AnalyticsGranularity,
  locale: string
): string {
  const date = parseBucket(bucket, granularity)
  if (!date) return bucket
  try {
    if (granularity === 'month') {
      return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short' }).format(date)
    }
    return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date)
  } catch {
    return bucket
  }
}

/** tooltip / 描述中的完整标签：day/week -> 2026年10月12日，month -> 2026年10月 */
export function formatBucketFullLabel(
  bucket: string,
  granularity: AnalyticsGranularity,
  locale: string
): string {
  const date = parseBucket(bucket, granularity)
  if (!date) return bucket
  try {
    if (granularity === 'month') {
      return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(date)
    }
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(date)
  } catch {
    return bucket
  }
}

/** 两位小时，用于 i18n 插值与 tooltip（14 -> "14"） */
export function padHour(hour: number): string {
  return String(Math.max(0, Math.min(24, Math.round(hour)))).padStart(2, '0')
}

/** 整点标签：14 -> "14:00" */
export function formatHourPoint(hour: number): string {
  return `${padHour(hour)}:00`
}

/** 整点区间：14 -> "14:00-15:00" */
export function formatHourRange(hour: number): string {
  return `${formatHourPoint(hour)}-${formatHourPoint(hour + 1)}`
}

/** 热力图 / 单日柱状图的最大值所在下标；全为 0 时返回 -1 */
export function maxValueIndex(values: number[]): number {
  let bestIndex = -1
  let bestValue = 0
  values.forEach((value, index) => {
    if (Number.isFinite(value) && value > bestValue) {
      bestValue = value
      bestIndex = index
    }
  })
  return bestIndex
}
