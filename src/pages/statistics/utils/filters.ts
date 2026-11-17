import type { AnalyticsQuery } from '@/lib/types'
import {
  DEFAULT_GRANULARITY_BY_PRESET,
  DEFAULT_LIMIT,
  DEFAULT_RANGE_PRESET,
  DEFAULT_RANGE_PRESET as FALLBACK_PRESET,
  formatDateKey,
  isGranularityDisabled,
  parseGranularity,
  parseRangePreset,
  parseResultLimit,
  resolveGranularity,
  resolvePresetRange,
  validateCustomRange,
  type CustomRangeError,
  type Granularity,
  type RangePreset,
  type ResultLimit,
} from './date'

/** URL 中保存的筛选条件 */
export interface StatisticsFilterValues {
  preset: RangePreset
  customStart: string | null
  customEnd: string | null
  /** null 表示使用预设的默认粒度 */
  granularity: Granularity | null
  tagId: string | null
  bookmarkId: string | null
  limit: ResultLimit
}

/** 解析后的区间（尚未经过服务端确认 days） */
export interface ResolvedFilterRange {
  start: string | null
  end: string
  days: number | null
  allTime: boolean
  customError: CustomRangeError | null
}

export const DEFAULT_FILTER_VALUES: StatisticsFilterValues = {
  preset: FALLBACK_PRESET,
  customStart: null,
  customEnd: null,
  granularity: null,
  tagId: null,
  bookmarkId: null,
  limit: DEFAULT_LIMIT,
}

/** 从 search params 解析筛选条件，非法值回退到默认值 */
export function parseStatisticsFilters(searchParams: URLSearchParams): StatisticsFilterValues {
  const preset = parseRangePreset(searchParams.get('range'))
  return {
    preset,
    customStart: preset === 'custom' ? (searchParams.get('start') ?? null) : null,
    customEnd: preset === 'custom' ? (searchParams.get('end') ?? null) : null,
    granularity: parseGranularity(searchParams.get('g')),
    tagId: searchParams.get('tag') || null,
    bookmarkId: searchParams.get('bookmark') || null,
    limit: parseResultLimit(searchParams.get('limit')),
  }
}

/** 写回 URL，省略默认值让链接保持简洁 */
export function buildStatisticsSearchParams(values: StatisticsFilterValues): URLSearchParams {
  const params = new URLSearchParams()
  if (values.preset !== DEFAULT_RANGE_PRESET) params.set('range', values.preset)
  if (values.preset === 'custom') {
    if (values.customStart) params.set('start', values.customStart)
    if (values.customEnd) params.set('end', values.customEnd)
  }
  if (values.granularity && values.granularity !== DEFAULT_GRANULARITY_BY_PRESET[values.preset]) {
    params.set('g', values.granularity)
  }
  if (values.tagId) params.set('tag', values.tagId)
  if (values.bookmarkId) params.set('bookmark', values.bookmarkId)
  if (values.limit !== DEFAULT_LIMIT) params.set('limit', String(values.limit))
  return params
}

/** 预设或自定义区间 -> 具体日期；自定义区间非法时返回错误 */
export function resolveFilterRange(
  values: StatisticsFilterValues,
  today: Date
): ResolvedFilterRange {
  if (values.preset !== 'custom') {
    const range = resolvePresetRange(values.preset, today)
    return {
      start: range.start,
      end: range.end,
      days: range.days,
      allTime: values.preset === 'all',
      customError: null,
    }
  }

  const validation = validateCustomRange(values.customStart, values.customEnd, today)
  if (!validation.valid || !validation.start || !validation.end) {
    return {
      start: null,
      end: formatDateKey(today),
      days: null,
      allTime: false,
      customError: validation.error ?? 'invalid',
    }
  }
  return {
    start: validation.start,
    end: validation.end,
    days: validation.days,
    allTime: false,
    customError: null,
  }
}

/** 用户请求的粒度：URL 覆盖优先，否则用预设默认值 */
export function getRequestedGranularity(values: StatisticsFilterValues): Granularity {
  return values.granularity ?? DEFAULT_GRANULARITY_BY_PRESET[values.preset]
}

/** 按实际区间长度修正粒度（>400 天时按日无效） */
export function getEffectiveGranularity(
  requested: Granularity,
  days: number | null | undefined
): Granularity {
  return resolveGranularity(requested, days)
}

export { isGranularityDisabled }

/** 构造请求参数；start 为 null 时省略，表示全部时间 */
export function buildAnalyticsQuery(input: {
  start: string | null
  end: string
  timeZone: string
  granularity: Granularity
  limit: ResultLimit
  tagId: string | null
  bookmarkId: string | null
}): AnalyticsQuery {
  return {
    startDate: input.start ?? undefined,
    endDate: input.end,
    tz: input.timeZone,
    granularity: input.granularity,
    limit: input.limit,
    tagId: input.tagId ?? undefined,
    bookmarkId: input.bookmarkId ?? undefined,
  }
}
