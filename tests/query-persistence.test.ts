import { afterEach, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { persistQueryClient } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import {
  QUERY_CACHE_BUSTER,
  QUERY_CACHE_STORAGE_KEY,
  saveQueryCacheNow,
  shouldPersistQuery,
} from '../src/lib/query-persistence'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it('注册入口与密钥管理状态不持久化，刷新后重新向服务端确认', () => {
  const cache = new QueryClient()
  for (const key of ['auth-options', 'registration-settings', 'passkeys']) {
    cache.setQueryData([key], { enabled: true })
    expect(shouldPersistQuery(cache.getQueryCache().find({ queryKey: [key] })!)).toBe(false)
  }
  cache.clear()
})

it('加载更多后立即刷新也能恢复分页和有效期，延迟写入不会覆盖新快照', async () => {
  vi.useFakeTimers()
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
  vi.stubGlobal('window', { localStorage: storage })
  const cache = new QueryClient()
  const persister = createSyncStoragePersister({
    storage,
    key: QUERY_CACHE_STORAGE_KEY,
    throttleTime: 1000,
  })
  const [unsubscribe, restored] = persistQueryClient({
    queryClient: cache,
    persister,
    buster: QUERY_CACHE_BUSTER,
  })
  await restored
  try {
    const key = ['bookmarks', 'infinite', 'alice']
    const expansionKey = ['bookmark-expansion', 'alice']
    cache.setQueryData(key, { pages: [{ bookmarks: [1, 2] }], pageParams: [undefined] })
    cache.setQueryData(key, {
      pages: [{ bookmarks: [1, 2] }, { bookmarks: [3, 4, 5] }],
      pageParams: [undefined, 'cursor'],
    })
    cache.setQueryData(expansionKey, Date.now())
    saveQueryCacheNow(cache)
    const snapshot = JSON.parse(storage.getItem(QUERY_CACHE_STORAGE_KEY)!)
    expect(snapshot.buster).toBe(QUERY_CACHE_BUSTER)
    expect(
      snapshot.clientState.queries.find(
        (query: { queryKey: string[] }) => query.queryKey[0] === 'bookmarks'
      ).state.data.pages
    ).toHaveLength(2)
    expect(
      snapshot.clientState.queries.find(
        (query: { queryKey: string[] }) => query.queryKey[0] === 'bookmark-expansion'
      ).state.data
    ).toBe(Date.now())
    await vi.advanceTimersByTimeAsync(1000)
    expect(JSON.parse(storage.getItem(QUERY_CACHE_STORAGE_KEY)!).clientState).toEqual(
      snapshot.clientState
    )
  } finally {
    unsubscribe()
    cache.clear()
  }
})
