import { afterEach, describe, expect, it, vi } from 'vitest'
import { dehydrate, hydrate, QueryClient } from '@tanstack/react-query'
import {
  firstBookmarkPage,
  getBookmarkPagination,
  isBookmarkExpansionExpired,
  resetExpiredBookmarkPages,
  type BookmarkPages,
} from '../src/lib/bookmark-pagination'
import type { Bookmark, BookmarksResponse } from '../src/lib/types'

const queryKey = ['bookmarks', 'infinite', 'alice', { sort: 'created' }, 30, 100]
const expansionKey = ['bookmark-expansion', 'alice', { sort: 'created' }, 30, 100]
const now = 1_800_000_000_000
const clients: QueryClient[] = []

function client() {
  const result = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(result)
  return result
}

function page(start: number, count: number, next?: string): BookmarksResponse {
  return {
    bookmarks: Array.from(
      { length: count },
      (_, index) => ({ id: String(start + index) }) as Bookmark
    ),
    meta: { page_size: count, count, has_more: Boolean(next), next_cursor: next },
  }
}

function sevenHundredBookmarks(): BookmarkPages {
  const counts = [30, 100, 100, 100, 100, 100, 100, 70]
  let start = 0
  return {
    pages: counts.map((count, index) => {
      const result = page(
        start,
        count,
        index < counts.length - 1 ? `cursor-${index + 1}` : undefined
      )
      start += count
      return result
    }),
    pageParams: [undefined, ...Array.from({ length: 7 }, (_, index) => `cursor-${index + 1}`)],
  }
}

afterEach(() => {
  clients.splice(0).forEach((value) => value.clear())
  vi.useRealTimers()
})

describe('书签加载设置', () => {
  it('兼容旧设置并提供 30 / 30 / 5 的默认值', () => {
    expect(getBookmarkPagination()).toEqual({ initialCount: 30, pageSize: 30, expiryMinutes: 5 })
    expect(getBookmarkPagination({ page_size: 50 })).toEqual({
      initialCount: 30,
      pageSize: 50,
      expiryMinutes: 5,
    })
  })

  it('首次数量与每次加载数量独立设置，支持每次进入重置', () => {
    expect(
      getBookmarkPagination({
        bookmark_initial_count: 20,
        page_size: 100,
        bookmark_load_more_expiry_minutes: 0,
      })
    ).toEqual({ initialCount: 20, pageSize: 100, expiryMinutes: 0 })
  })

  it('损坏的本地设置回退为合法值', () => {
    expect(
      getBookmarkPagination({
        bookmark_initial_count: 0,
        page_size: 201,
        bookmark_load_more_expiry_minutes: -1,
      })
    ).toEqual({ initialCount: 30, pageSize: 30, expiryMinutes: 5 })
    expect(
      getBookmarkPagination({
        bookmark_initial_count: 1.5,
        page_size: NaN,
        bookmark_load_more_expiry_minutes: Infinity,
      })
    ).toEqual({ initialCount: 30, pageSize: 30, expiryMinutes: 5 })
  })
})

describe('展开状态有效期', () => {
  it('在到期边界恢复默认数量', () => {
    expect(isBookmarkExpansionExpired(now - 299_999, 5, now)).toBe(false)
    expect(isBookmarkExpansionExpired(now - 300_000, 5, now)).toBe(true)
    expect(isBookmarkExpansionExpired(now, 0, now)).toBe(true)
  })

  it.each([undefined, null, '1800000000000', NaN, Infinity, 0, now + 1])(
    '无效时间 %s 视为过期',
    (timestamp) => {
      expect(isBookmarkExpansionExpired(timestamp, 5, now)).toBe(true)
    }
  )
})

describe('分页缓存恢复', () => {
  it('700 个书签过期后保留首批 30 个、首批游标和原始刷新时间', async () => {
    vi.useFakeTimers().setSystemTime(now)
    const cache = client()
    cache.setQueryData(queryKey, sevenHundredBookmarks(), { updatedAt: now - 3_600_000 })
    cache.setQueryData(expansionKey, now - 300_000)
    expect(await resetExpiredBookmarkPages(cache, queryKey, expansionKey, 5)).toBe(true)
    const result = cache.getQueryData<BookmarkPages>(queryKey)!
    expect(result.pages.flatMap((value) => value.bookmarks)).toHaveLength(30)
    expect(result.pageParams).toEqual([undefined])
    expect(result.pages[0]?.meta).toMatchObject({ has_more: true, next_cursor: 'cursor-1' })
    expect(cache.getQueryState(queryKey)?.dataUpdatedAt).toBe(now - 3_600_000)
    expect(cache.getQueryData(expansionKey)).toBeUndefined()
  })

  it('持久化恢复后，有效期内保留展开数量，过期则收起', async () => {
    vi.useFakeTimers().setSystemTime(now)
    const previous = client()
    previous.setQueryData(queryKey, sevenHundredBookmarks())
    previous.setQueryData(expansionKey, now - 240_000)
    const restored = client()
    hydrate(restored, JSON.parse(JSON.stringify(dehydrate(previous))))
    expect(await resetExpiredBookmarkPages(restored, queryKey, expansionKey, 5)).toBe(false)
    expect(restored.getQueryData<BookmarkPages>(queryKey)?.pages).toHaveLength(8)
    vi.setSystemTime(now + 60_000)
    expect(await resetExpiredBookmarkPages(restored, queryKey, expansionKey, 5)).toBe(true)
    expect(restored.getQueryData<BookmarkPages>(queryKey)?.pages).toHaveLength(1)
  })

  it('旧版缺少展开时间的整批缓存重置，其他用户的缓存不受影响', async () => {
    const cache = client()
    const otherKey = ['bookmarks', 'infinite', 'bob', { sort: 'popular' }, 30, 100]
    cache.setQueryData(queryKey, sevenHundredBookmarks())
    cache.setQueryData(otherKey, sevenHundredBookmarks())
    await resetExpiredBookmarkPages(cache, queryKey, expansionKey, 5)
    expect(cache.getQueryData<BookmarkPages>(queryKey)?.pages).toHaveLength(1)
    expect(cache.getQueryData<BookmarkPages>(otherKey)?.pages).toHaveLength(8)
  })

  it('后台刷新不延长展开有效期', async () => {
    vi.useFakeTimers().setSystemTime(now)
    const cache = client()
    cache.setQueryData(queryKey, sevenHundredBookmarks())
    cache.setQueryData(expansionKey, now - 300_001)
    cache.setQueryData(queryKey, sevenHundredBookmarks())
    expect(await resetExpiredBookmarkPages(cache, queryKey, expansionKey, 5)).toBe(true)
  })

  it('取消后台刷新，防止收起后再次恢复 700 个书签', async () => {
    const cache = client()
    cache.setQueryData(queryKey, sevenHundredBookmarks())
    let finish!: (value: BookmarkPages) => void
    const fetching = cache
      .fetchQuery({
        queryKey,
        staleTime: 0,
        queryFn: () =>
          new Promise<BookmarkPages>((resolve) => {
            finish = resolve
          }),
      })
      .catch(() => undefined)
    await resetExpiredBookmarkPages(cache, queryKey, expansionKey, 5)
    finish(sevenHundredBookmarks())
    await fetching
    expect(cache.getQueryData<BookmarkPages>(queryKey)?.pages).toHaveLength(1)
  })

  it('首批数据保持稳定，也支持空列表', () => {
    const empty: BookmarkPages = { pages: [], pageParams: [] }
    const single: BookmarkPages = { pages: [page(0, 5)], pageParams: [undefined] }
    expect(firstBookmarkPage(empty)).toBe(empty)
    expect(firstBookmarkPage(single)).toBe(single)
  })
})
