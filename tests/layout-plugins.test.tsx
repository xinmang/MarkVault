import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PluginState } from '../shared/plugin-types'
import type { Bookmark, Tag } from '../src/lib/types'
import { PluginContext } from '../src/plugins/context'
import { getBuiltinNavigation, getPluginCategory } from '../src/plugins/navigation'
import {
  LAYOUT_PLUGIN_IDS,
  availableLayouts,
  useRunningLayoutPlugins,
} from '../src/plugins/layouts'
import {
  CORE_VIEW_MODES,
  PLUGIN_TAG_LAYOUTS,
  PLUGIN_VIEW_MODES,
} from '../src/lib/constants/bookmarks'
import {
  domainGroups,
  tagScale,
  tagWeight,
  timelineGroups,
} from '../plugins/builtin/layouts/grouping'
import { BOOKMARK_LAYOUT_VIEWS, TAG_LAYOUT_VIEWS } from '../plugins/builtin/layouts/registry'
import { TagCloud } from '../plugins/builtin/tag-cloud/TagCloud'
import { TagBars } from '../plugins/builtin/tag-bars/TagBars'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'zh-CN' } }),
}))

function bookmark(id: string, url: string, created: Date | string): Bookmark {
  return {
    id,
    url,
    title: id,
    created_at: typeof created === 'string' ? created : created.toISOString(),
    tags: [],
  } as unknown as Bookmark
}

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

function running(plugins: PluginState[], options: { safe?: boolean; enabled?: boolean } = {}) {
  let result: ReadonlySet<string> | undefined
  function Probe() {
    result = useRunningLayoutPlugins(options.enabled)
    return null
  }
  renderToStaticMarkup(
    createElement(
      PluginContext.Provider,
      {
        value: {
          directory: { plugins, admin: false, apiVersion: '1.0.0', runtimeAvailable: true },
          ready: true,
          safe: options.safe ?? false,
          refresh: async () => undefined,
        },
      },
      createElement(Probe)
    )
  )
  return [...result!]
}

describe('布局插件的启停决定可切换的布局', () => {
  it('每种插件布局都有对应的内置插件、实现，并归在设置页的布局视图分区', () => {
    expect(LAYOUT_PLUGIN_IDS).toEqual([
      'view-gallery',
      'view-timeline',
      'view-domains',
      'view-focus',
      'tag-cloud',
      'tag-bars',
      'tab-board',
      'tab-compact',
    ])
    expect(Object.keys(BOOKMARK_LAYOUT_VIEWS)).toEqual([...PLUGIN_VIEW_MODES])
    expect(Object.keys(TAG_LAYOUT_VIEWS)).toEqual([...PLUGIN_TAG_LAYOUTS])
    for (const id of LAYOUT_PLUGIN_IDS) {
      expect(getBuiltinNavigation('markvault.' + id)?.category).toBe('layouts')
      expect(getBuiltinNavigation('markvault.' + id)?.section).toBe('layouts')
      expect(getPluginCategory(plugin(id))).toBe('layouts')
    }
    expect(getBuiltinNavigation('markvault.tab-board')?.page).toBe('/tab')
  })

  it('只有正在运行的布局插件计入，停用、实例停用、安全模式和公开页都不计入', () => {
    const plugins = [
      plugin('view-gallery'),
      plugin('view-focus', { enabled: false, status: 'disabled' }),
      plugin('tag-cloud', { disabled: true }),
      plugin('tab-board'),
      plugin('statistics'),
      plugin('view-timeline', { origin: 'community' }),
    ]
    expect(running(plugins)).toEqual(['view-gallery', 'tab-board'])
    expect(running(plugins, { safe: true })).toEqual([])
    expect(running(plugins, { enabled: false })).toEqual([])
  })

  it('核心布局始终可用，插件布局按固定顺序追加', () => {
    const active = new Set(['view-focus', 'view-gallery', 'tag-bars'])
    expect(availableLayouts(CORE_VIEW_MODES, PLUGIN_VIEW_MODES, 'view-', active)).toEqual([
      ...CORE_VIEW_MODES,
      'gallery',
      'focus',
    ])
    expect(availableLayouts(['grid', 'masonry'], PLUGIN_TAG_LAYOUTS, 'tag-', active)).toEqual([
      'grid',
      'masonry',
      'bars',
    ])
    expect(availableLayouts(['default'], ['board', 'compact'], 'tab-', active)).toEqual(['default'])
  })
})

describe('时间线分段', () => {
  const now = new Date(2026, 10, 13, 15, 0)
  const at = (month: number, day: number, hour = 12) => new Date(2026, month, day, hour)

  it('按今天、昨天、近 7 天和月份从近到远分段，段内保持原顺序', () => {
    const groups = timelineGroups(
      [
        bookmark('十月', 'https://a.test', at(9, 20)),
        bookmark('今天早', 'https://a.test', at(10, 13, 0)),
        bookmark('本月更早', 'https://a.test', at(10, 2)),
        bookmark('昨天', 'https://a.test', at(10, 12, 23)),
        bookmark('今天晚', 'https://a.test', at(10, 13, 14)),
        bookmark('六天前', 'https://a.test', at(10, 7, 0)),
        bookmark('七天前', 'https://a.test', at(10, 6, 23)),
      ],
      now
    )
    expect(groups.map((group) => [group.period, group.items.map((item) => item.id)])).toEqual([
      ['today', ['今天早', '今天晚']],
      ['yesterday', ['昨天']],
      ['week', ['六天前']],
      ['month', ['本月更早', '七天前']],
      ['month', ['十月']],
    ])
    expect(groups[3]!.start).toBe(new Date(2026, 10, 1).getTime())
  })

  it('无法解析的时间单独归到末尾，不会混入其他时间段', () => {
    const groups = timelineGroups(
      [bookmark('坏', 'https://a.test', '不是时间'), bookmark('好', 'https://a.test', at(10, 13))],
      now
    )
    expect(groups.map((group) => group.period)).toEqual(['today', 'unknown'])
  })
})

describe('站点分组', () => {
  it('同站点合并并忽略 www 前缀，书签多的在前，单条站点合并到末尾', () => {
    const groups = domainGroups([
      bookmark('1', 'https://solo.test/a', ''),
      bookmark('2', 'https://www.docs.test/a', ''),
      bookmark('3', 'https://news.test/a', ''),
      bookmark('4', 'https://docs.test/b', ''),
      bookmark('5', 'https://news.test/b', ''),
      bookmark('6', 'https://news.test/c', ''),
      bookmark('7', '无效网址', ''),
    ])
    expect(groups.map((group) => [group.host, group.items.map((item) => item.id)])).toEqual([
      ['news.test', ['3', '5', '6']],
      ['docs.test', ['2', '4']],
      ['', ['1', '7']],
    ])
  })

  it('没有单条站点时不产生“其他站点”分组', () => {
    const groups = domainGroups([
      bookmark('1', 'https://a.test/1', ''),
      bookmark('2', 'https://a.test/2', ''),
    ])
    expect(groups.map((group) => group.host)).toEqual(['a.test'])
  })
})

describe('标签云与标签排行', () => {
  const tags: Tag[] = [
    { id: 'hot', name: '常用', color: null, bookmark_count: 99, click_count: 1 },
    { id: 'cold', name: '冷门', color: null, bookmark_count: 0, click_count: 40 },
    { id: 'mid', name: '一般', color: null, bookmark_count: 9 },
  ]
  const props = {
    tags,
    selectedTags: ['hot'],
    relatedTagIds: new Set(['mid']),
    showIcons: false,
    onToggle: () => undefined,
  }

  it('权重跟随排序方式，缩放结果在 0 到 1 之间', () => {
    expect(tagWeight(tags[0]!, 'usage')).toBe(99)
    expect(tagWeight(tags[0]!, 'name')).toBe(99)
    expect(tagWeight(tags[0]!, 'clicks')).toBe(1)
    expect(tagWeight(tags[2]!, 'clicks')).toBe(0)
    expect(tagScale(99, 99)).toBe(1)
    expect(tagScale(0, 99)).toBe(0)
    expect(tagScale(5, 0)).toBe(0)
    expect(tagScale(9, 99)).toBeCloseTo(0.5)
  })

  it('标签云保留联动与选中语义，并标出已选、待选和其他', () => {
    const html = renderToStaticMarkup(createElement(TagCloud, { ...props, sortBy: 'usage' }))
    expect(html.match(/class="tag-item layout-cloud__tag"/g)).toHaveLength(3)
    expect(html).toContain('aria-pressed="true" data-link-tag="hot" data-state="selected"')
    expect(html).toContain('aria-pressed="false" data-link-tag="mid" data-state="related"')
    expect(html).toContain('aria-pressed="false" data-link-tag="cold" data-state="dimmed"')
    expect(html).toContain('--tag-scale:1')
    expect(html).toContain('--tag-scale:0"')
  })

  it('标签排行的横条按当前排序方式的最大值换算，没有选择时不标状态', () => {
    const usage = renderToStaticMarkup(
      createElement(TagBars, { ...props, selectedTags: [], relatedTagIds: new Set(), sortBy: 'usage' })
    )
    expect(usage).not.toContain('data-state')
    expect(usage).toContain('style="width:100%"')
    expect(usage).toContain('style="width:0%"')
    const clicks = renderToStaticMarkup(createElement(TagBars, { ...props, sortBy: 'clicks' }))
    expect(clicks).toContain('style="width:2.5%"')
    expect(clicks).toContain('<span class="layout-bars__count">40</span>')
  })
})
