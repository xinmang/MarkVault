import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { subDays } from 'date-fns'
import {
  formatDateKey,
  parseDateKey,
  type CustomRangeError,
  type Granularity,
  type RangePreset,
  type ResultLimit,
} from '../utils/date'
import {
  buildStatisticsSearchParams,
  getEffectiveGranularity,
  getRequestedGranularity,
  parseStatisticsFilters,
  resolveFilterRange,
  type StatisticsFilterValues,
} from '../utils/filters'

export interface StatisticsFiltersController {
  values: StatisticsFilterValues
  /** 用户请求的粒度（可能是被降级前的 day） */
  requestedGranularity: Granularity
  /** 实际生效的粒度（>400 天时按周） */
  granularity: Granularity
  today: Date
  todayKey: string
  earliestKey: string
  rangeStart: string | null
  rangeEnd: string
  rangeDays: number | null
  customError: CustomRangeError | null
  setPreset: (preset: RangePreset) => void
  setCustomRange: (start: string | null, end: string | null) => void
  /** 下钻到某个桶：一次性写入自定义区间与按日粒度，只产生一条历史记录 */
  drillDown: (start: string, end: string) => void
  setGranularity: (granularity: Granularity) => void
  setTagId: (tagId: string | null) => void
  setBookmarkId: (bookmarkId: string | null) => void
  setLimit: (limit: ResultLimit) => void
}

/**
 * 把筛选状态保存在 URL search params 中：
 * 每次变更都 push 新的历史记录，浏览器 Back 可以撤销一次下钻。
 */
export function useStatisticsFilters(): StatisticsFiltersController {
  const [searchParams, setSearchParams] = useSearchParams()

  // 以渲染时的本地自然日作为“今天”，避免跨天后出现未来日期
  const today = useMemo(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  }, [])

  const values = useMemo(() => parseStatisticsFilters(searchParams), [searchParams])
  const resolvedRange = useMemo(() => resolveFilterRange(values, today), [values, today])
  const requestedGranularity = getRequestedGranularity(values)
  const granularity = getEffectiveGranularity(requestedGranularity, resolvedRange.days)

  const apply = useCallback(
    (next: StatisticsFilterValues) => {
      setSearchParams(buildStatisticsSearchParams(next), { replace: false })
    },
    [setSearchParams]
  )

  const setPreset = useCallback(
    (preset: RangePreset) => {
      if (preset === 'custom') {
        // 选择自定义时用当前区间的起点作为初始值，避免出现空白日期输入
        const range = resolveFilterRange(values, today)
        apply({
          ...values,
          preset,
          customStart: range.start ?? formatDateKey(subDays(today, 29)),
          customEnd: range.end,
        })
        return
      }
      apply({ ...values, preset, customStart: null, customEnd: null })
    },
    [apply, today, values]
  )

  const setCustomRange = useCallback(
    (start: string | null, end: string | null) => {
      const startDate = parseDateKey(start)
      apply({
        ...values,
        preset: 'custom',
        customStart: startDate ? formatDateKey(startDate) : null,
        customEnd: end,
      })
    },
    [apply, values]
  )

  const setGranularity = useCallback(
    (next: Granularity) => {
      apply({ ...values, granularity: next })
    },
    [apply, values]
  )

  const drillDown = useCallback(
    (start: string, end: string) => {
      const startDate = parseDateKey(start)
      const endDate = parseDateKey(end)
      if (!startDate || !endDate) return
      apply({
        ...values,
        preset: 'custom',
        customStart: formatDateKey(startDate),
        customEnd: formatDateKey(endDate),
        granularity: 'day',
      })
    },
    [apply, values]
  )

  const setTagId = useCallback(
    (tagId: string | null) => {
      apply({ ...values, tagId })
    },
    [apply, values]
  )

  const setBookmarkId = useCallback(
    (bookmarkId: string | null) => {
      apply({ ...values, bookmarkId })
    },
    [apply, values]
  )

  const setLimit = useCallback(
    (limit: ResultLimit) => {
      apply({ ...values, limit })
    },
    [apply, values]
  )

  return {
    values,
    requestedGranularity,
    granularity,
    today,
    todayKey: formatDateKey(today),
    earliestKey: formatDateKey(subDays(today, 3659)),
    rangeStart: resolvedRange.start,
    rangeEnd: resolvedRange.end,
    rangeDays: resolvedRange.days,
    customError: resolvedRange.customError,
    setPreset,
    setCustomRange,
    drillDown,
    setGranularity,
    setTagId,
    setBookmarkId,
    setLimit,
  }
}
