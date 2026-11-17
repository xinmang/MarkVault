/**
 * React Query 客户端配置
 * 
 * 提供持久化缓存支持，减少 API 请求，提升用户体验
 */

import { QueryClient } from '@tanstack/react-query'
import { persistQueryClient } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { QUERY_CACHE_STORAGE_KEY, QUERY_CACHE_BUSTER, shouldPersistQuery } from './query-persistence'

/**
 * 创建持久化存储
 * 使用 localStorage 存储缓存数据
 */
const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: QUERY_CACHE_STORAGE_KEY,
  serialize: JSON.stringify,
  deserialize: JSON.parse,
})

/**
 * 创建 QueryClient 实例
 * 
 * 配置说明:
 * - staleTime: 30分钟 (书签变化不频繁)
 * - gcTime: 24小时 (保留缓存数据)
 * - refetchOnWindowFocus: true (窗口聚焦时刷新)
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 60 * 1000,       // 30分钟
      gcTime: 24 * 60 * 60 * 1000,     // 24小时
      retry: 2,
      refetchOnWindowFocus: true,       // 窗口聚焦时刷新
      refetchOnReconnect: true,         // 重新连接时刷新
    },
    mutations: {
      retry: 1,
    },
  },
})

/**
 * 启用持久化
 * 
 * 配置说明:
 * - maxAge: 24小时 (缓存最大保留时间)
 * - buster: 版本号 (更新版本号会清除旧缓存)
 */
/**
 * 不写入持久化缓存的查询。
 *
 * 站点品牌必须每次启动/刷新都重新向服务端确认，
 * 否则会在本地长期展示旧的站点名称、Logo 与描述。
 * 过滤规则定义在 query-persistence，与立即保存共用。
 */
persistQueryClient({
  queryClient,
  persister,
  maxAge: 24 * 60 * 60 * 1000,  // 24小时
  buster: QUERY_CACHE_BUSTER,                  // 版本控制
  dehydrateOptions: {
    shouldDehydrateQuery: shouldPersistQuery,
  },
})
