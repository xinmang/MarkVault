/**
 * 版本更新检测
 *
 * 机制：直接读取 GitHub 主分支上的 package.json（每次发版都会更新 version 字段），
 * 与构建时注入的 __APP_VERSION__ 比较。结果缓存在 localStorage，
 * 6 小时内不重复请求；网络失败时静默降级为“无更新”，只显示当前版本号。
 */

export const LATEST_PACKAGE_URL =
  'https://raw.githubusercontent.com/xinmang/MarkVault/main/package.json'

export const UPDATE_CHECK_CACHE_KEY = 'markvault:update-check'
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

interface UpdateCheckCache {
  latestVersion: string
  checkedAt: number
}

/** 按点分数字逐段比较版本号；a > b 返回正数。非数字段按 0 处理 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v.trim().replace(/^v/i, '').split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0)
  const left = parse(a)
  const right = parse(b)
  const length = Math.max(left.length, right.length)
  for (let i = 0; i < length; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export function readUpdateCache(
  storage: Pick<Storage, 'getItem'> = localStorage
): UpdateCheckCache | null {
  try {
    const raw = storage.getItem(UPDATE_CHECK_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<UpdateCheckCache>
    if (typeof parsed.latestVersion !== 'string' || typeof parsed.checkedAt !== 'number') return null
    return { latestVersion: parsed.latestVersion, checkedAt: parsed.checkedAt }
  } catch {
    return null
  }
}

export function isCacheFresh(
  cache: UpdateCheckCache | null,
  now = Date.now()
): cache is UpdateCheckCache {
  return !!cache && now - cache.checkedAt >= 0 && now - cache.checkedAt < UPDATE_CHECK_INTERVAL_MS
}

/** 拉取远端最新版本号并写入缓存；失败返回 null */
export async function fetchLatestVersion(signal?: AbortSignal): Promise<string | null> {
  try {
    const response = await fetch(LATEST_PACKAGE_URL, { cache: 'no-store', credentials: 'omit', signal })
    if (!response.ok) return null
    const data = (await response.json()) as { version?: unknown }
    if (typeof data.version !== 'string' || !/^\d+(\.\d+)*/.test(data.version.trim())) return null
    const latestVersion = data.version.trim()
    try {
      localStorage.setItem(
        UPDATE_CHECK_CACHE_KEY,
        JSON.stringify({ latestVersion, checkedAt: Date.now() })
      )
    } catch {
      // 隐私模式等无法写入时忽略，下次再查
    }
    return latestVersion
  } catch {
    return null
  }
}
