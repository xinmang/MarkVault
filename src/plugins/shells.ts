import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useRunningBuiltins } from './layouts'

/**
 * 页面版式：由主题外观插件提供的整页骨架。
 * 与“布局视图”插件不同，版式接管整个页面的排版（标签、工具栏、列表和侧栏放在哪里），
 * 而不是只替换其中一块。首页版式对应内置插件 markvault.home-<名称>，
 * 标签页组版式对应 markvault.tabs-<名称>。
 */
export const HOME_SHELLS = ['topbar', 'launchpad', 'reader', 'tagboard', 'canvas'] as const
export const TAB_SHELLS = ['tabbed', 'wall', 'timeline', 'canvas'] as const
export type PluginHomeShell = (typeof HOME_SHELLS)[number]
export type PluginTabShell = (typeof TAB_SHELLS)[number]

/** 宽度不足时退回默认骨架的版式（三栏需要桌面宽度）。 */
export const DESKTOP_ONLY_SHELLS: readonly string[] = ['home-reader']

const PAGES = {
  home: { names: HOME_SHELLS, prefix: 'home-', storageKey: 'markvault:home_shell' },
  tabs: { names: TAB_SHELLS, prefix: 'tabs-', storageKey: 'markvault:tab_shell' },
} as const
export type ShellPage = keyof typeof PAGES
export type ShellName<Page extends ShellPage> = (typeof PAGES)[Page]['names'][number]
export const SHELL_PAGES = Object.keys(PAGES) as ShellPage[]

/** 全部版式插件的内置 ID（不含 markvault. 前缀）。 */
export const SHELL_PLUGIN_IDS: readonly string[] = SHELL_PAGES.flatMap((page) =>
  PAGES[page].names.map((name) => PAGES[page].prefix + name)
)

export function shellPluginId(page: ShellPage, name: string): string {
  return PAGES[page].prefix + name
}

export function shellNames<Page extends ShellPage>(page: Page): readonly ShellName<Page>[] {
  return PAGES[page].names
}

/** 内置插件 ID（可带 markvault. 前缀）对应的页面与版式名；不是版式插件时返回 undefined。 */
export function parseShellPlugin(id: string): { page: ShellPage; name: string } | undefined {
  const bare = id.startsWith('markvault.') ? id.slice('markvault.'.length) : id
  if (!SHELL_PLUGIN_IDS.includes(bare)) return undefined
  const page = SHELL_PAGES.find((candidate) => bare.startsWith(PAGES[candidate].prefix))!
  return { page, name: bare.slice(PAGES[page].prefix.length) }
}

const CACHE_KEY = 'markvault:shell_plugins'
const CHANGE_EVENT = 'markvault:shell-change'

function readStored(page: ShellPage): string | null {
  try {
    return window.localStorage.getItem(PAGES[page].storageKey)
  } catch {
    return null
  }
}

/** 记住当前浏览器在该页面使用的版式；default 表示明确选择默认骨架。 */
export function setStoredShell(page: ShellPage, name: string) {
  try {
    window.localStorage.setItem(PAGES[page].storageKey, name)
  } catch {
    // 无法保存时仅本次会话生效
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

function subscribe(notify: () => void) {
  window.addEventListener(CHANGE_EVENT, notify)
  window.addEventListener('storage', notify)
  return () => {
    window.removeEventListener(CHANGE_EVENT, notify)
    window.removeEventListener('storage', notify)
  }
}

/**
 * 由已保存的选择和正在运行的版式得出实际使用的版式。
 * 从未在本浏览器选择过时，使用第一个正在运行的版式，账号里启用的版式在新设备上直接生效；
 * 选择的版式已停用时回到默认骨架，但不改写选择，重新启用后恢复。
 */
export function resolveShell<Name extends string>(
  stored: string | null,
  available: readonly Name[]
): Name | 'default' {
  if (stored === null) return available[0] ?? 'default'
  return available.find((name) => name === stored) ?? 'default'
}

export function useRunningShellPlugins(enabled = true): ReadonlySet<string> {
  return useRunningBuiltins(SHELL_PLUGIN_IDS, CACHE_KEY, enabled)
}

/** 某个页面当前可用的版式、实际使用的版式与切换方法。 */
export function usePageShell<Page extends ShellPage>(page: Page) {
  const running = useRunningShellPlugins()
  const stored = useSyncExternalStore(
    subscribe,
    () => readStored(page),
    () => null
  )
  const available = useMemo(
    () =>
      shellNames(page).filter((name) =>
        running.has(shellPluginId(page, name))
      ) as ShellName<Page>[],
    [page, running]
  )
  const select = useCallback((name: string) => setStoredShell(page, name), [page])
  return { active: resolveShell(stored, available), available, stored, select }
}
