import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query'
import type { BookmarksResponse, UserPreferences } from '@/lib/types'

export type BookmarkPages = InfiniteData<BookmarksResponse, string | undefined>

function integerInRange(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback
}

export function getBookmarkPagination(preferences?: Partial<UserPreferences>) {
  return {
    initialCount: integerInRange(preferences?.bookmark_initial_count, 30, 1, 200),
    pageSize: integerInRange(preferences?.page_size, 30, 1, 200),
    expiryMinutes: integerInRange(preferences?.bookmark_load_more_expiry_minutes, 5, 0, 1440),
  }
}

export function isBookmarkExpansionExpired(
  expandedAt: unknown,
  expiryMinutes: number,
  now = Date.now()
): boolean {
  return (
    expiryMinutes === 0 ||
    typeof expandedAt !== 'number' ||
    !Number.isFinite(expandedAt) ||
    expandedAt <= 0 ||
    expandedAt > now ||
    now - expandedAt >= expiryMinutes * 60_000
  )
}

export function firstBookmarkPage(data: BookmarkPages): BookmarkPages {
  if (data.pages.length <= 1) return data
  return { ...data, pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) }
}

/** 先停止旧分页的刷新，再同时收起数据和游标，防止后台请求恢复整批书签。 */
export async function resetExpiredBookmarkPages(
  queryClient: QueryClient,
  queryKey: QueryKey,
  expansionKey: QueryKey,
  expiryMinutes: number
): Promise<boolean> {
  const expandedAt = queryClient.getQueryData<number>(expansionKey)
  if (!isBookmarkExpansionExpired(expandedAt, expiryMinutes)) return false

  const data = queryClient.getQueryData<BookmarkPages>(queryKey)
  const needsReset = (data?.pages.length ?? 0) > 1
  if (needsReset) {
    await queryClient.cancelQueries({ queryKey, exact: true })
    const updatedAt = queryClient.getQueryState(queryKey)?.dataUpdatedAt
    queryClient.setQueryData<BookmarkPages>(
      queryKey,
      (current) => (current ? firstBookmarkPage(current) : current),
      { updatedAt }
    )
  }
  queryClient.removeQueries({ queryKey: expansionKey, exact: true })
  return needsReset
}
