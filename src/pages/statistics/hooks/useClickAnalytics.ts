import { useEffect, useMemo } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { analyticsService } from '@/services/analytics'
import type { AnalyticsQuery, AnalyticsResponse } from '@/lib/types'
import { logger } from '@/lib/logger'
import { getUserTimeZone, type Granularity, type ResultLimit } from '../utils/date'
import { buildAnalyticsQuery } from '../utils/filters'

export interface UseClickAnalyticsInput {
  start: string | null
  end: string
  granularity: Granularity
  limit: ResultLimit
  tagId: string | null
  bookmarkId: string | null
  /** 自定义区间非法时暂停请求，避免把无效区间当成“全部时间” */
  enabled?: boolean
}

export interface UseClickAnalyticsResult {
  data: AnalyticsResponse | undefined
  isLoading: boolean
  isFetching: boolean
  isError: boolean
  refetch: () => void
  query: AnalyticsQuery
}

/**
 * 拉取点击统计。筛选变化时保留上一份数据（keepPreviousData），
 * 只在首次加载时显示 spinner，避免骨架屏闪烁。
 */
export function useClickAnalytics(input: UseClickAnalyticsInput): UseClickAnalyticsResult {
  const timeZone = useMemo(() => getUserTimeZone(), [])

  const query = useMemo(
    () =>
      buildAnalyticsQuery({
        start: input.start,
        end: input.end,
        timeZone,
        granularity: input.granularity,
        limit: input.limit,
        tagId: input.tagId,
        bookmarkId: input.bookmarkId,
      }),
    [
      input.start,
      input.end,
      input.granularity,
      input.limit,
      input.tagId,
      input.bookmarkId,
      timeZone,
    ]
  )

  const result = useQuery({
    queryKey: ['analytics', query],
    queryFn: ({ signal }) => analyticsService.getClickAnalytics(query, signal),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    enabled: input.enabled ?? true,
  })

  const { isError, error, refetch } = result
  useEffect(() => {
    if (!isError) return
    logger.warn('加载点击统计失败：', error instanceof Error ? error.message : 'unknown')
  }, [isError, error])

  return {
    data: result.data,
    isLoading: result.isLoading,
    isFetching: result.isFetching,
    isError,
    refetch: () => {
      void refetch()
    },
    query,
  }
}
