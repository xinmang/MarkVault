import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PluginState } from '../shared/plugin-types'
import type { Bookmark, Tag } from '../src/lib/types'
import { PluginContext } from '../src/plugins/context'
import { getBuiltinNavigation, getPluginCategory } from '../src/plugins/navigation'
import {
  HOME_SHELLS,
  SHELL_PLUGIN_IDS,
  TAB_SHELLS,
  parseShellPlugin,
  resolveShell,
  usePageShell,
  useRunningShellPlugins,
} from '../src/plugins/shells'
import { LAYOUT_PLUGIN_IDS } from '../src/plugins/layouts'
import {
  dayPart,
  quickAccessBookmarks,
  tabStripEntries,
  tagColumns,
  wallColumns,
} from '../plugins/builtin/shells/grouping'
import { HOME_SHELL_VIEWS, SHELL_ICONS, TAB_SHELL_VIEWS } from '../plugins/builtin/shells/registry'
import { ShellSwitcher } from '../plugins/builtin/shells/ShellSwitcher'
import zh from '../src/i18n/locales/zh-CN/plugins.json'
import en from '../src/i18n/locales/en/plugins.json'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'zh-CN' } }),
}))

function plugin(id: string, overrides: Partial<PluginState> = {}): PluginState {
  return {
    manifest: {
      id: 'markvault.' + id,
      name: id,
      version: '1.0.0',
      api: '^1.0.0',
      author: '测试',
      permissions: [],
      contributes: [],
    },
    origin: 'builtin',
    enabled: true,
    disabled: false,
    status: 'running',
    config: {},
    grants: [],
    revision: '1',
    ...overrides,
  }
}

function probe<Result>(read: () => Result, plugins: PluginState[], safe = false): Result {
  let result: Result | undefined
  function Probe() {
    result = read()
    return null
  }
  renderToStaticMarkup(
    createElement(
      PluginContext.Provider,
      {
        value: {
          directory: { plugins, admin: false, apiVersion: '1.0.0', runtimeAvailable: true },
          ready: true,
          safe,
          refresh: async () => undefined,
        },
      },
      createElement(Probe)
    )
  )
  return result as Result
}

function bookmark(id: string, extra: Partial<Bookmark> = {}): Bookmark {
  return { id, url: 'https://example.com/' + id, title: id, tags: [], ...extra } as Bookmark
}
const tag = (id: string) => ({ id, name: id }) as Tag

describe('页面版式插件', () => {
  it('每个版式都有对应的内置插件、实现、图标和文案，归属主题外观', () => {
    expect(SHELL_PLUGIN_IDS).toEqual([
      'home-topbar',
      'home-launchpad',
      'home-reader',
      'home-tagboard',
      'home-canvas',
      'tabs-tabbed',
      'tabs-wall',
      'tabs-timeline',
      'tabs-canvas',
    ])
    expect(Object.keys(HOME_SHELL_VIEWS)).toEqual([...HOME_SHELLS])
    expect(Object.keys(TAB_SHELL_VIEWS)).toEqual([...TAB_SHELLS])
    for (const id of SHELL_PLUGIN_IDS) {
      const shell = parseShellPlugin('markvault.' + id)!
      expect(getBuiltinNavigation('markvault.' + id)).toEqual({
        category: 'appearance',
        section: 'theme',
        page: shell.page === 'home' ? '/' : '/tab',
        picker: true,
      })
      expect(getPluginCategory(plugin(id))).toBe('appearance')
      expect(SHELL_ICONS[shell.page][shell.name]).toBeTruthy()
      for (const locale of [zh, en]) {
        expect((locale.summary as Record<string, string>)[id]).toBeTruthy()
        const names = locale.shells[shell.page] as Record<string, { name: string } | string>
        expect(names[shell.name]).toHaveProperty('name')
        expect(names.default).toHaveProperty('name')
      }
      // 版式与布局视图插件互不重名
      expect(LAYOUT_PLUGIN_IDS).not.toContain(id)
    }
    expect(parseShellPlugin('markvault.vibehub')).toBeUndefined()
    expect(parseShellPlugin('home-reader')).toEqual({ page: 'home', name: 'reader' })
  })

  it('只有正在运行的版式可用，安全模式回到默认骨架', () => {
    const plugins = [
      plugin('home-reader'),
      plugin('home-topbar', { enabled: false, status: 'disabled' }),
      plugin('home-tagboard', { disabled: true }),
      plugin('tabs-wall'),
      plugin('view-gallery'),
    ]
    expect([...probe(() => useRunningShellPlugins(), plugins)]).toEqual([
      'home-reader',
      'tabs-wall',
    ])
    expect([...probe(() => useRunningShellPlugins(), plugins, true)]).toEqual([])
    expect([...probe(() => useRunningShellPlugins(false), plugins)]).toEqual([])
    const home = probe(() => usePageShell('home'), plugins)
    expect(home.available).toEqual(['reader'])
    expect(home.active).toBe('reader')
    expect(probe(() => usePageShell('tabs'), plugins).active).toBe('wall')
    expect(probe(() => usePageShell('home'), plugins, true).active).toBe('default')
    expect(probe(() => usePageShell('home'), []).active).toBe('default')
  })

  it('未选择过时用第一个运行中的版式，选择停用后回到默认但不丢失选择', () => {
    expect(resolveShell(null, [])).toBe('default')
    expect(resolveShell(null, ['launchpad', 'reader'])).toBe('launchpad')
    expect(resolveShell('reader', ['launchpad', 'reader'])).toBe('reader')
    expect(resolveShell('default', ['launchpad'])).toBe('default')
    expect(resolveShell('reader', ['launchpad'])).toBe('default')
    expect(resolveShell('不存在', ['launchpad'])).toBe('default')
  })

  it('没有启用版式插件时不显示切换按钮', () => {
    const render = (available: string[]) =>
      renderToStaticMarkup(
        <ShellSwitcher
          page="home"
          active="default"
          available={available}
          onSelect={() => undefined}
          className="btn"
        />
      )
    expect(render([])).toBe('')
    expect(render(['topbar'])).toContain('shells.switch')
  })
})

describe('页面版式的分组计算', () => {
  it('快捷访问先放置顶，再按访问次数，未访问过的不占位', () => {
    const items = [
      bookmark('a', { click_count: 3 }),
      bookmark('b'),
      bookmark('c', { is_pinned: true }),
      bookmark('d', { click_count: 9 }),
      bookmark('e', { is_pinned: true, click_count: 1 }),
    ]
    expect(quickAccessBookmarks(items).map((item) => item.id)).toEqual(['c', 'e', 'd', 'a'])
    expect(quickAccessBookmarks(items, 2).map((item) => item.id)).toEqual(['c', 'e'])
    expect(quickAccessBookmarks([bookmark('x')])).toEqual([])
  })

  it('标签看板按标签顺序成列，多标签书签出现在多列，未加标签的排最后', () => {
    const [x, y, z] = [tag('x'), tag('y'), tag('z')]
    const items = [bookmark('1', { tags: [y, x] }), bookmark('2'), bookmark('3', { tags: [y] })]
    const columns = tagColumns(items, [x, y, z])
    expect(columns.map((column) => [column.tag?.id, column.items.map((item) => item.id)])).toEqual([
      ['x', ['1']],
      ['y', ['1', '3']],
      [undefined, ['2']],
    ])
    expect(tagColumns(items, [x, y, z], 1).map((column) => column.tag?.id)).toEqual([
      'x',
      undefined,
    ])
    expect(tagColumns([], [x])).toEqual([])
  })

  it('问候语按时段划分', () => {
    const at = (hour: number) => dayPart(new Date(2026, 0, 1, hour))
    expect([4, 5, 11, 12, 17, 18, 22, 23].map(at)).toEqual([
      'night',
      'morning',
      'morning',
      'afternoon',
      'afternoon',
      'evening',
      'evening',
      'night',
    ])
  })

  it('分组栏与分组树同序，文件夹数量为其下分组之和，孤儿分组当作顶层', () => {
    const group = (
      id: string,
      position: number,
      parent_id: string | null = null,
      extra: object = {}
    ) => ({ id, position, parent_id, is_folder: 0, item_count: 2 as number | undefined, ...extra })
    const entries = tabStripEntries([
      group('b', 2),
      group('f', 1, null, { is_folder: 1, item_count: 99 }),
      group('f2', 2, 'f'),
      group('f1', 1, 'f', { item_count: undefined, items: [1, 2, 3] }),
      group('orphan', 3, 'missing'),
    ])
    expect(entries.map((entry) => [entry.group.id, entry.depth, entry.count])).toEqual([
      ['f', 0, 5],
      ['f1', 1, 3],
      ['f2', 1, 2],
      ['b', 0, 2],
      ['orphan', 0, 2],
    ])
  })

  it('卡片墙把分组依次放进最短的一列', () => {
    const group = (id: string, size: number) => ({ id, items: Array(size).fill(0) })
    const columns = wallColumns([group('a', 10), group('b', 1), group('c', 1), group('d', 1)], 2)
    expect(columns.map((column) => column.map((item) => item.id))).toEqual([['a'], ['b', 'c', 'd']])
    expect(wallColumns([group('a', 1)], 0)).toEqual([[{ id: 'a', items: [0] }]])
  })
})
