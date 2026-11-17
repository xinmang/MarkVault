import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { DropdownMenuPanel } from '../src/components/common/DropdownMenu'
import { SearchToolbar } from '../src/components/common/SearchToolbar'
import { SearchBar } from '../src/components/tab-groups/SearchBar'
import { SORT_OPTIONS, VISIBILITY_FILTERS, VIEW_MODES } from '../src/lib/constants/bookmarks'
import zhBookmarks from '../src/i18n/locales/zh-CN/bookmarks.json'
import enBookmarks from '../src/i18n/locales/en/bookmarks.json'
import zhShare from '../src/i18n/locales/zh-CN/share.json'
import enShare from '../src/i18n/locales/en/share.json'
import zhTabGroups from '../src/i18n/locales/zh-CN/tabGroups.json'
import enTabGroups from '../src/i18n/locales/en/tabGroups.json'
import zhTags from '../src/i18n/locales/zh-CN/tags.json'
import enTags from '../src/i18n/locales/en/tags.json'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}))

const noop = () => undefined

describe('工具栏下拉菜单', () => {
  it('单选菜单标出当前项，普通菜单保持原有语义', () => {
    const html = renderToStaticMarkup(
      <DropdownMenuPanel
        onClose={noop}
        items={[
          { label: '卡片', selected: true, onClick: noop },
          { label: '列表', selected: false, onClick: noop },
          { label: '删除', danger: true, divider: true, onClick: noop },
        ]}
      />
    )
    expect(html).toContain('role="menu"')
    expect(html.match(/role="menuitemradio"/g)).toHaveLength(2)
    expect(html).toMatch(/role="menuitemradio" aria-checked="true"[^>]*text-primary/)
    expect(html).toContain('aria-checked="false"')
    // 只有当前项带选中标记
    expect(html.match(/lucide-check/g)).toHaveLength(1)
    expect(html).toMatch(/role="separator".*role="menuitem"[^>]*text-destructive/s)
    // 主题样式依赖这个类名
    expect(html).toContain('vibehub-popover')
  })

  it('书签工具栏的排序、可见性和视图都是带菜单的按钮，显示当前项', () => {
    const html = renderToStaticMarkup(
      <SearchToolbar
        searchMode="bookmark"
        onSearchModeToggle={noop}
        searchKeyword=""
        onSearchKeywordChange={noop}
        sortBy="popular"
        onSortByChange={noop}
        visibilityFilter="public"
        onVisibilityChange={noop}
        viewMode="list"
        onViewModeChange={noop}
        availableViewModes={['list', 'card']}
      />
    )
    // 手机与桌面两套布局各渲染一组
    expect(html.match(/aria-haspopup="menu"/g)).toHaveLength(6)
    for (const label of ['sort.popular', 'filter.public', 'viewMode.list'])
      expect(html.match(new RegExp(`aria-label="${label}"`, 'g'))).toHaveLength(2)
    // 筛选不是“全部”时按钮高亮
    expect(html).toMatch(/text-primary[^>]*aria-label="filter.public"/)
  })

  it('标签页组的排序始终可选，布局菜单只在有多种布局时出现', () => {
    const render = (layouts?: readonly ('default' | 'board' | 'compact')[]) =>
      renderToStaticMarkup(
        <MemoryRouter>
          <SearchBar
            searchQuery=""
            onSearchChange={noop}
            sortBy="title"
            onSortChange={noop}
            onBatchModeToggle={noop}
            batchMode={false}
            layout="default"
            layouts={layouts}
            onLayoutChange={noop}
          />
        </MemoryRouter>
      )
    const single = render(['default'])
    expect(single).toContain('aria-label="sort.title"')
    expect(single.match(/aria-haspopup="menu"/g)).toHaveLength(1)
    expect(single).not.toContain('<select')
    expect(render(['default', 'board']).match(/aria-haspopup="menu"/g)).toHaveLength(2)
    expect(render().match(/aria-haspopup="menu"/g)).toHaveLength(1)
  })

  it('菜单里的每个选项在两种语言里都有名称', () => {
    for (const locale of [zhBookmarks, enBookmarks, zhShare, enShare]) {
      for (const sort of SORT_OPTIONS) expect(locale.sort).toHaveProperty(sort)
      for (const filter of VISIBILITY_FILTERS) expect(locale.filter).toHaveProperty(filter)
      for (const mode of VIEW_MODES) expect(locale.viewMode).toHaveProperty(mode)
    }
    for (const locale of [zhTabGroups, enTabGroups]) {
      for (const sort of ['created', 'title', 'count']) expect(locale.sort).toHaveProperty(sort)
      for (const layout of ['default', 'board', 'compact'])
        expect(locale.layout).toHaveProperty(layout)
    }
    for (const locale of [zhTags, enTags]) {
      for (const sort of ['usage', 'clicks', 'name']) expect(locale.sort.names).toHaveProperty(sort)
      for (const layout of ['grid', 'masonry', 'cloud', 'bars'])
        expect(locale.layout.names).toHaveProperty(layout)
    }
  })
})
