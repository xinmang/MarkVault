/**
 * 本地书签封面/图标的签名 URL 只有 1 小时有效期。
 *
 * 页面长时间停留、后台标签页恢复或持久化缓存还原后，旧签名会失效，
 * 导致图片永久退回到默认图标。这里根据当前已加载数据里的 exp
 * 计算下一次重新拉取列表（后端会重新签发）的时间。
 */

/** 只有本地签名图片路径需要关注；仅自动续签服务端管理的本地图片。 */
const LOCAL_BOOKMARK_IMAGE_PREFIXES = [
  '/api/bookmark-images/images/',
  '/api/bookmark-screenshots/',
] as const

/** 提前量：在签名到期前 1 分钟刷新，留出请求和渲染的时间。 */
const REFRESH_AHEAD_MS = 60 * 1000

/** 最短间隔：即使签名已过期，也不允许紧密轮询。 */
const MIN_REFRESH_INTERVAL_MS = 60 * 1000

/** 浏览器定时器上限（约 24.8 天），超出会被当成 1ms 造成紧密轮询。 */
const MAX_TIMER_DELAY_MS = 2_147_483_647

/** exp 秒数换算成毫秒后仍需是安全整数。 */
const MAX_SAFE_EXP_SECONDS = Math.floor(Number.MAX_SAFE_INTEGER / 1000)

export interface BookmarkImageFields {
  cover_image?: string | null
  favicon?: string | null
  screenshot?: { url?: string | null } | null
}

/**
 * 从本地签名图片 URL 中取出有效的 exp（秒）。
 * 外站 URL、缺少 exp、非整数或非正数的 exp 都视为“无有效签名”，返回 null。
 */
function signedExpirySeconds(rawUrl: string | null | undefined): number | null {
  if (!rawUrl) return null

  const trimmed = rawUrl.trim()
  if (!LOCAL_BOOKMARK_IMAGE_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) return null

  const queryIndex = trimmed.indexOf('?')
  if (queryIndex < 0) return null

  const exp = new URLSearchParams(trimmed.slice(queryIndex + 1)).get('exp')
  if (!exp || !/^\d+$/.test(exp)) return null

  const seconds = Number(exp)
  if (
    !Number.isSafeInteger(seconds) ||
    seconds <= 0 ||
    seconds > MAX_SAFE_EXP_SECONDS
  ) {
    return null
  }
  return seconds
}

/**
 * 计算 React Query 的 refetchInterval。
 *
 * - 没有任何带有效签名的本地图片时返回 false（不轮询）
 * - 有签名图片时取最早到期时间，在到期前 1 分钟重新拉取
 * - 结果不会小于 1 分钟（已过期也不会紧密轮询），也不会超出浏览器定时器上限
 */
export function bookmarkImageRefreshInterval(
  bookmarks: ReadonlyArray<BookmarkImageFields> | null | undefined,
  nowMs: number = Date.now()
): number | false {
  if (!bookmarks || bookmarks.length === 0) return false

  let earliestExpiryMs: number | null = null
  for (const bookmark of bookmarks) {
    const urls = [bookmark.cover_image, bookmark.favicon, bookmark.screenshot?.url]
    for (const url of urls) {
      const seconds = signedExpirySeconds(url)
      if (seconds === null) continue
      const expiryMs = seconds * 1000
      if (earliestExpiryMs === null || expiryMs < earliestExpiryMs) {
        earliestExpiryMs = expiryMs
      }
    }
  }

  if (earliestExpiryMs === null) return false

  const delay = earliestExpiryMs - REFRESH_AHEAD_MS - nowMs
  // 已过期或距离到期不足一分钟时取最短间隔，同时不超出浏览器定时器上限
  return Math.min(MAX_TIMER_DELAY_MS, Math.max(MIN_REFRESH_INTERVAL_MS, delay))
}
