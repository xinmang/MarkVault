import {
  differenceInCalendarDays,
  format,
  isValid,
  parseISO,
  startOfMonth,
  startOfYear,
  subDays,
} from 'date-fns'

/** 统计页支持的时间范围预设 */
export const RANGE_PRESETS = [
  'today',
  'yesterday',
  '7d',
  '30d',
  '90d',
  'month',
  'year',
  'all',
  'custom',
] as const

export type RangePreset = (typeof RANGE_PRESETS)[number]

export const GRANULARITIES = ['day', 'week', 'month'] as const
export type Granularity = (typeof GRANULARITIES)[number]

/** 区间超过该天数时不再提供按日粒度 */
export const DAILY_GRANULARITY_MAX_DAYS = 400
/** 服务端允许的最大区间天数 */
export const MAX_RANGE_DAYS = 3660

export const DEFAULT_RANGE_PRESET: RangePreset = '30d'

export const LIMIT_OPTIONS = [10, 20, 50] as const
export type ResultLimit = (typeof LIMIT_OPTIONS)[number]
export const DEFAULT_LIMIT: ResultLimit = 10

/** 每个预设的默认粒度，用户可在界面上覆盖 */
export const DEFAULT_GRANULARITY_BY_PRESET: Record<RangePreset, Granularity> = {
  today: 'day',
  yesterday: 'day',
  '7d': 'day',
  '30d': 'day',
  '90d': 'day',
  month: 'day',
  year: 'week',
  all: 'month',
  custom: 'day',
}

export interface DateRange {
  /** null 表示不限制起点（全部时间） */
  start: string | null
  end: string
  /** null 表示起点未知（全部时间），需要等待服务端返回 */
  days: number | null
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** Date -> YYYY-MM-DD（本地时区） */
export function formatDateKey(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

/** YYYY-MM-DD -> Date；非法日期返回 null */
export function parseDateKey(value: string | null | undefined): Date | null {
  if (!value || !DATE_KEY_PATTERN.test(value)) return null
  const parsed = parseISO(value)
  if (!isValid(parsed)) return null
  // parseISO 会把 2026-02-31 解析成 3 月，这里再校验一次往返结果
  if (formatDateKey(parsed) !== value) return null
  return parsed
}

/** 含首尾两天的自然日天数，非法输入返回 null */
export function daysBetween(start: string, end: string): number | null {
  const startDate = parseDateKey(start)
  const endDate = parseDateKey(end)
  if (!startDate || !endDate) return null
  return differenceInCalendarDays(endDate, startDate) + 1
}

function rangeFromDates(start: Date, end: Date): DateRange {
  const startKey = formatDateKey(start)
  const endKey = formatDateKey(end)
  return {
    start: startKey,
    end: endKey,
    days: (daysBetween(startKey, endKey) ?? 1) || 1,
  }
}

/**
 * 预设 -> 具体日期区间。`today` 必须传入固定日期，保证纯函数可测试。
 * `all` 不返回起点（请求时省略 startDate），`custom` 由调用方自行解析。
 */
export function resolvePresetRange(preset: RangePreset, today: Date): DateRange {
  switch (preset) {
    case 'today':
      return rangeFromDates(today, today)
    case 'yesterday': {
      const yesterday = subDays(today, 1)
      return rangeFromDates(yesterday, yesterday)
    }
    case '7d':
      return rangeFromDates(subDays(today, 6), today)
    case '30d':
      return rangeFromDates(subDays(today, 29), today)
    case '90d':
      return rangeFromDates(subDays(today, 89), today)
    case 'month':
      return rangeFromDates(startOfMonth(today), today)
    case 'year':
      return rangeFromDates(startOfYear(today), today)
    case 'all':
      return { start: null, end: formatDateKey(today), days: null }
    case 'custom':
      return { start: null, end: formatDateKey(today), days: null }
    default:
      return rangeFromDates(subDays(today, 29), today)
  }
}

export type CustomRangeError = 'incomplete' | 'invalid' | 'order' | 'future' | 'tooLong'

export interface CustomRangeValidation {
  valid: boolean
  error: CustomRangeError | null
  start: string | null
  end: string | null
  days: number | null
}

/**
 * 自定义日期区间校验：完整性、合法性、先后顺序、未来日期与最大跨度。
 */
export function validateCustomRange(
  startValue: string | null,
  endValue: string | null,
  today: Date
): CustomRangeValidation {
  if (!startValue || !endValue) {
    return { valid: false, error: 'incomplete', start: null, end: null, days: null }
  }
  const startDate = parseDateKey(startValue)
  const endDate = parseDateKey(endValue)
  if (!startDate || !endDate) {
    return { valid: false, error: 'invalid', start: null, end: null, days: null }
  }

  const days = differenceInCalendarDays(endDate, startDate) + 1
  if (days <= 0) {
    return { valid: false, error: 'order', start: startValue, end: endValue, days: null }
  }
  if (formatDateKey(endDate) > formatDateKey(today)) {
    return { valid: false, error: 'future', start: startValue, end: endValue, days: null }
  }
  if (days > MAX_RANGE_DAYS) {
    return { valid: false, error: 'tooLong', start: startValue, end: endValue, days }
  }
  return { valid: true, error: null, start: startValue, end: endValue, days }
}

/** 解析 URL 中的 range，非法值回退到默认预设 */
export function parseRangePreset(value: string | null): RangePreset {
  if (value && (RANGE_PRESETS as readonly string[]).includes(value)) {
    return value as RangePreset
  }
  return DEFAULT_RANGE_PRESET
}

/** 解析 URL 中的粒度，非法值返回 null（回退到预设默认粒度） */
export function parseGranularity(value: string | null): Granularity | null {
  if (value === 'day' || value === 'week' || value === 'month') return value
  return null
}

/** 解析 URL 中的排行榜条数 */
export function parseResultLimit(value: string | null): ResultLimit {
  const parsed = Number(value)
  return (LIMIT_OPTIONS as readonly number[]).includes(parsed)
    ? (parsed as ResultLimit)
    : DEFAULT_LIMIT
}

/** 区间超过 400 天时按日粒度降级为按周 */
export function resolveGranularity(
  requested: Granularity,
  days: number | null | undefined
): Granularity {
  if (requested === 'day' && typeof days === 'number' && days > DAILY_GRANULARITY_MAX_DAYS) {
    return 'week'
  }
  return requested
}

/** 当前区间是否禁用某个粒度按钮 */
export function isGranularityDisabled(
  granularity: Granularity,
  days: number | null | undefined
): boolean {
  return granularity === 'day' && typeof days === 'number' && days > DAILY_GRANULARITY_MAX_DAYS
}

/** 用户所在时区（IANA 名称），无法获取时回退 UTC */
export function getUserTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return zone && zone.trim() ? zone : 'UTC'
  } catch {
    return 'UTC'
  }
}
