import { useCallback, useEffect, useMemo, useState } from 'react'
import { hashKey, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { bookmarksService } from '@/services/bookmarks'
import { usePreferences } from './usePreferences'
import { useAuthStore } from '@/stores/authStore'
import { saveQueryCacheNow } from '@/lib/query-persistence'
import { bookmarkImageRefreshInterval } from '@/lib/bookmark-image-refresh'
import {
  firstBookmarkPage,
  getBookmarkPagination,
  isBookmarkExpansionExpired,
  resetExpiredBookmarkPages,
} from '@/lib/bookmark-pagination'
import type {
  BookmarkQueryParams,
  CreateBookmarkRequest,
  UpdateBookmarkRequest,
  BatchActionRequest,
} from '@/lib/types'

export const BOOKMARKS_QUERY_KEY = 'bookmarks'

/**
 * 获取书签列表
 * 
 * 优化说明:
 * - staleTime: 30分钟 (书签变化不频繁)
 * - gcTime: 24小时 (持久化缓存)
 * - refetchOnWindowFocus: true (窗口聚焦时刷新)
 * - refetchInterval: 本地签名图片临近过期时重新拉取，由后端重新签发 URL
 */
export function useBookmarks(params?: BookmarkQueryParams, options?: { staleTime?: number; gcTime?: number }) {
  return useQuery({
    queryKey: [BOOKMARKS_QUERY_KEY, params],
    queryFn: () => bookmarksService.getBookmarks(params),
    staleTime: options?.staleTime || 30 * 60 * 1000, // 30分钟
    gcTime: options?.gcTime || 24 * 60 * 60 * 1000, // 24小时
    refetchOnWindowFocus: 'always', // 窗口聚焦时刷新，保持数据同步
    refetchInterval: (query) => bookmarkImageRefreshInterval(query.state.data?.bookmarks ?? []),
    // 后台标签页不轮询，切回窗口时由聚焦刷新接管
    refetchIntervalInBackground: false,
  })
}

/**
 * 按用户设置加载书签；展开状态只由成功的“加载更多”续期。
 * 返回页面时先清理过期分页，避免持久化缓存一直恢复整批书签。
 */
export function useInfiniteBookmarks(
  params?: BookmarkQueryParams,
  options?: { staleTime?: number; cacheTime?: number }
) {
  const queryClient = useQueryClient()
  const { data: preferences } = usePreferences()
  const userId = useAuthStore((state) => state.user?.id)
  const { initialCount, pageSize, expiryMinutes } = getBookmarkPagination(preferences)
  // 与普通列表以及旧版无限分页隔离，也隔离不同用户和分页设置。
  const queryKey = useMemo(
    () => [BOOKMARKS_QUERY_KEY, 'infinite', userId, params, initialCount, pageSize],
    [userId, params, initialCount, pageSize]
  )
  const expansionKey = useMemo(
    () => ['bookmark-expansion', userId, params, initialCount, pageSize],
    [userId, params, initialCount, pageSize]
  )
  const queryHash = hashKey(queryKey)
  const [initializedHash, setInitializedHash] = useState<string | null>(null)
  const initialized = initializedHash === queryHash

  useEffect(() => {
    let active = true
    const prepare = async () => {
      await resetExpiredBookmarkPages(queryClient, queryKey, expansionKey, expiryMinutes)
      if (active) setInitializedHash(queryHash)
    }
    void prepare()

    // 浏览中不定时收起；重新进入、刷新或切回窗口时才检查有效期。
    const handleReturn = () => {
      if (document.visibilityState === 'hidden') return
      void resetExpiredBookmarkPages(queryClient, queryKey, expansionKey, expiryMinutes)
        .then((reset) => {
          if (active && reset) {
            return queryClient.refetchQueries({ queryKey, exact: true, type: 'active' })
          }
        })
    }
    window.addEventListener('focus', handleReturn)
    document.addEventListener('visibilitychange', handleReturn)
    return () => {
      active = false
      window.removeEventListener('focus', handleReturn)
      document.removeEventListener('visibilitychange', handleReturn)
    }
  }, [queryClient, queryKey, expansionKey, queryHash, expiryMinutes])

  const query = useInfiniteQuery({
    queryKey,
    enabled: initialized,
    queryFn: ({ pageParam, signal }) =>
      bookmarksService.getBookmarks(
        {
          ...params,
          page_size: pageParam === undefined ? initialCount : pageSize,
          page_cursor: pageParam,
        },
        signal
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => (lastPage.meta?.has_more ? lastPage.meta.next_cursor : undefined),
    // 初始化清理完成前也不展示已过期的持久化分页。
    select: (data) =>
      !initialized && isBookmarkExpansionExpired(queryClient.getQueryData(expansionKey), expiryMinutes)
        ? firstBookmarkPage(data)
        : data,
    staleTime: options?.staleTime ?? 30 * 60 * 1000,
    gcTime: options?.cacheTime ?? 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: 'always',
    // 依据当前已加载的所有页计算签名图片的刷新时间，不改变分页展开有效期
    refetchInterval: (query) =>
      bookmarkImageRefreshInterval(
        query.state.data?.pages.flatMap((page) => page.bookmarks) ?? []
      ),
    // 后台标签页不轮询，切回窗口时由聚焦刷新接管
    refetchIntervalInBackground: false,
  })

  const { fetchNextPage: fetchPage } = query
  const fetchNextPage = useCallback(async () => {
    const previousPages = query.data?.pages.length ?? 0
    const result = await fetchPage({ cancelRefetch: false })
    if (!result.isError && (result.data?.pages.length ?? 0) > previousPages) {
      // 独立保存时间，后台刷新和书签编辑都不会延长展开状态的有效期。
      queryClient.setQueryData(expansionKey, Date.now())
      saveQueryCacheNow(queryClient)
    }
    return result
  }, [fetchPage, query.data?.pages.length, queryClient, expansionKey])

  return { ...query, isLoading: query.isPending, fetchNextPage }
}

/**
 * 创建书签
 * 
 * 成功后自动刷新书签和标签缓存
 */
export function useCreateBookmark() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: CreateBookmarkRequest) => bookmarksService.createBookmark(data),
    onSuccess: async () => {
      // 成功后刷新所有书签查询
      try {
        await queryClient.invalidateQueries({ queryKey: [BOOKMARKS_QUERY_KEY] })
        await queryClient.invalidateQueries({ queryKey: ['tags'] })
      } catch (error) {
        console.error('Failed to invalidate queries:', error)
      }
    },
  })
}

/**
 * 更新书签
 */
export function useUpdateBookmark() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateBookmarkRequest }) =>
      bookmarksService.updateBookmark(id, data),
    onSuccess: async () => {
      try {
        await queryClient.invalidateQueries({ queryKey: [BOOKMARKS_QUERY_KEY] })
        await queryClient.invalidateQueries({ queryKey: ['tags'] })
      } catch (error) {
        console.error('Failed to invalidate queries:', error)
      }
    },
  })
}

/**
 * 删除书签
 */
export function useDeleteBookmark() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => bookmarksService.deleteBookmark(id),
    onSuccess: async () => {
      try {
        await queryClient.invalidateQueries({ queryKey: [BOOKMARKS_QUERY_KEY] })
        await queryClient.invalidateQueries({ queryKey: ['tags'] })
      } catch (error) {
        console.error('Failed to invalidate queries:', error)
      }
    },
  })
}

/**
 * 恢复书签
 */
export function useRestoreBookmark() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => bookmarksService.restoreBookmark(id),
    onSuccess: async () => {
      try {
        await queryClient.invalidateQueries({ queryKey: [BOOKMARKS_QUERY_KEY] })
        await queryClient.invalidateQueries({ queryKey: ['tags'] })
      } catch (error) {
        console.error('Failed to invalidate queries:', error)
      }
    },
  })
}

/**
 * 记录书签点击
 */
export function useRecordClick() {
  return useMutation({
    mutationFn: (id: string) => bookmarksService.recordClick(id),
  })
}

/**
 * 删除书签的网站截图
 *
 * 成功后刷新书签列表，让各视图重新拿到 screenshot = null 的数据。
 */
export function useDeleteScreenshot() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => bookmarksService.deleteScreenshot(id),
    onSuccess: async () => {
      try {
        await queryClient.invalidateQueries({ queryKey: [BOOKMARKS_QUERY_KEY] })
      } catch (error) {
        console.error('Failed to invalidate queries:', error)
      }
    },
  })
}

/**
 * 批量操作书签
 */
export function useBatchAction() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: BatchActionRequest) => bookmarksService.batchAction(data),
    onSuccess: async () => {
      // 使用 catch 来防止 invalidateQueries 的错误影响 mutation 结果
      try {
        await queryClient.invalidateQueries({ queryKey: [BOOKMARKS_QUERY_KEY] })
        await queryClient.invalidateQueries({ queryKey: ['tags'] })
      } catch (error) {
        console.error('Failed to invalidate queries:', error)
        // 即使缓存失效失败也不应该让操作显示为失败
      }
    },
  })
}
