import { dehydrate, type Query, type QueryClient } from '@tanstack/react-query'
import { logger } from './logger'

export const QUERY_CACHE_STORAGE_KEY = 'markvault-cache'
// v2：清理缺少完整待选标签的旧分页缓存，避免升级后继续漏标。
// v3：清除升级前不带 u/b/scope/exp/sig 的图片 URL 缓存，避免长期使用失效的永久链接。
export const QUERY_CACHE_BUSTER = 'v3'

/**
 * 不写入持久化缓存的查询键。
 *
 * 站点品牌与 can_edit 必须每次启动、刷新都重新向服务端确认，
 * 否则会在本地长期展示旧的站点名称、Logo、描述或过期的可编辑状态。
 */
const NON_PERSISTED_QUERY_KEYS = new Set([
  'site-branding',
  'site-settings',
  'plugins',
  'auth-options',
  'registration-settings',
  'passkeys',
  // 备注可能随时被 Agent 追加，每次打开弹窗都重新读取
  'notes',
])

/**
 * 持久化过滤规则，供自动持久化与立即保存两个入口共用。
 * 保持原行为：只持久化成功的查询，额外排除站点品牌相关查询。
 */
export function shouldPersistQuery(query: Query): boolean {
  return (
    query.state.status === 'success' &&
    !NON_PERSISTED_QUERY_KEYS.has(String(query.queryKey[0] ?? ''))
  )
}

/** 用户主动展开后立即落盘，避免缓存写入节流导致刷新丢失分页和有效期。 */
export function saveQueryCacheNow(queryClient: QueryClient): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      QUERY_CACHE_STORAGE_KEY,
      JSON.stringify({
        timestamp: Date.now(),
        buster: QUERY_CACHE_BUSTER,
        // 立即保存同样要走持久化过滤，避免把站点品牌等易变查询写进本地缓存
        clientState: dehydrate(queryClient, { shouldDehydrateQuery: shouldPersistQuery }),
      })
    )
  } catch (error) {
    logger.warn('无法立即保存分页缓存，当前页面仍可继续使用：', error)
  }
}
