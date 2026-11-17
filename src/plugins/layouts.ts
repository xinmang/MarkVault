import { useEffect, useMemo } from 'react'
import { PLUGIN_TAG_LAYOUTS, PLUGIN_VIEW_MODES } from '@/lib/constants/bookmarks'
import { usePlugins } from './context'
import { isPluginRunning } from './navigation'

/** 标签页组页面的布局；board 与 compact 由布局插件提供，只保存在当前浏览器。 */
export const PLUGIN_TAB_LAYOUTS = ['board', 'compact'] as const
export const TAB_LAYOUTS = ['default', ...PLUGIN_TAB_LAYOUTS] as const
export type TabLayout = (typeof TAB_LAYOUTS)[number]
export const TAB_LAYOUT_STORAGE_KEY = 'markvault:tab_groups_layout'

/** 全部布局插件的内置 ID（不含 markvault. 前缀），插件 ID 与布局名一一对应。 */
export const LAYOUT_PLUGIN_IDS: readonly string[] = [
  ...PLUGIN_VIEW_MODES.map((mode) => 'view-' + mode),
  ...PLUGIN_TAG_LAYOUTS.map((layout) => 'tag-' + layout),
  ...PLUGIN_TAB_LAYOUTS.map((layout) => 'tab-' + layout),
]

const CACHE_KEY = 'markvault:layout_plugins'
const NONE: ReadonlySet<string> = new Set()

function readCache(ids: readonly string[], cacheKey: string): ReadonlySet<string> {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(cacheKey) ?? '[]')
    if (!Array.isArray(stored)) return NONE
    return new Set(stored.filter((id) => ids.includes(id)))
  } catch {
    return NONE
  }
}

/**
 * 返回 ids 中正在运行的内置插件 ID 集合（不含 markvault. 前缀）。ids 必须是模块级常量。
 * 插件目录加载完成前沿用上次结果，避免已选的插件布局在每次刷新时先闪回默认布局；
 * 安全模式和公开页面（enabled 为 false）不启用任何插件。
 */
export function useRunningBuiltins(
  ids: readonly string[],
  cacheKey: string,
  enabled = true
): ReadonlySet<string> {
  const { directory, safe, ready } = usePlugins()
  const settled = ready && !!directory
  const running = useMemo(() => {
    if (!enabled || safe) return NONE
    if (!settled) return readCache(ids, cacheKey)
    return new Set(
      directory.plugins
        .filter((item) => item.origin === 'builtin' && isPluginRunning(item))
        .map((item) => item.manifest.id.slice('markvault.'.length))
        .filter((id) => ids.includes(id))
    )
  }, [cacheKey, directory, enabled, ids, safe, settled])
  useEffect(() => {
    if (!enabled || safe || !settled) return
    try {
      window.localStorage.setItem(cacheKey, JSON.stringify([...running]))
    } catch {
      // 存储不可用时只影响刷新瞬间的布局，不影响功能
    }
  }, [cacheKey, enabled, running, safe, settled])
  return running
}

/** 返回正在运行的布局插件 ID 集合。 */
export function useRunningLayoutPlugins(enabled = true): ReadonlySet<string> {
  return useRunningBuiltins(LAYOUT_PLUGIN_IDS, CACHE_KEY, enabled)
}

/** 把固定的核心选项与正在运行的插件选项拼成当前可切换的列表。 */
export function availableLayouts<Core extends string, Extra extends string>(
  core: readonly Core[],
  extra: readonly Extra[],
  prefix: 'view-' | 'tag-' | 'tab-',
  running: ReadonlySet<string>
): (Core | Extra)[] {
  return [...core, ...extra.filter((name) => running.has(prefix + name))]
}

export function getStoredTabLayout(): TabLayout {
  try {
    const stored = window.localStorage.getItem(TAB_LAYOUT_STORAGE_KEY)
    return TAB_LAYOUTS.find((layout) => layout === stored) ?? 'default'
  } catch {
    return 'default'
  }
}

export function setStoredTabLayout(layout: TabLayout) {
  try {
    window.localStorage.setItem(TAB_LAYOUT_STORAGE_KEY, layout)
  } catch {
    // 无法保存时仅本次会话生效
  }
}
