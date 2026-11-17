/**
 * 共享搜索工具栏组件
 * 搜索输入 + 排序/可见性/视图模式下拉菜单
 * 被 BookmarksPage (TopActionBar) 和 PublicSharePage 复用
 */

import { ReactNode } from 'react'
import { Tag as TagIcon, Search, Bookmark as BookmarkIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SORT_OPTIONS, VISIBILITY_FILTERS } from '@/lib/constants/bookmarks'
import type { ViewMode, VisibilityFilter } from '@/lib/constants/bookmarks'
import type { SortOption } from '@/components/common/SortSelector'
import { ViewModeIcon, VisibilityIcon, SortIcon } from '@/components/common/BookmarkIcons'
import { DropdownMenu, type MenuItem } from '@/components/common/DropdownMenu'

interface SearchToolbarProps {
  searchMode: 'bookmark' | 'tag'
  onSearchModeToggle: () => void
  searchKeyword: string
  onSearchKeywordChange: (keyword: string) => void
  sortBy: SortOption
  onSortByChange: (sort: SortOption) => void
  visibilityFilter: VisibilityFilter
  onVisibilityChange: (filter: VisibilityFilter) => void
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  /** 视图菜单里列出的视图，顺序即菜单顺序 */
  availableViewModes: readonly ViewMode[]
  /** 移动端标签抽屉触发按钮 */
  onOpenTagDrawer?: () => void
  /** 额外的操作按钮（批量模式、添加、回收站等） */
  extraActions?: ReactNode
  /** 搜索框 placeholder 的 i18n namespace */
  i18nNs?: string
}

export function SearchToolbar({
  searchMode,
  onSearchModeToggle,
  searchKeyword,
  onSearchKeywordChange,
  sortBy,
  onSortByChange,
  visibilityFilter,
  onVisibilityChange,
  viewMode,
  onViewModeChange,
  availableViewModes,
  onOpenTagDrawer,
  extraActions,
  i18nNs = 'bookmarks',
}: SearchToolbarProps) {
  const { t } = useTranslation(i18nNs)

  // 排序、可见性、视图三个下拉菜单，手机和桌面两套布局共用
  const toolMenus = (
    <>
      <ToolMenu
        label={t(`sort.${sortBy}`, sortBy)}
        icon={<SortIcon sort={sortBy} />}
        items={SORT_OPTIONS.map((sort) => ({
          label: t(`sort.${sort}`, sort),
          icon: <SortIcon sort={sort} />,
          selected: sort === sortBy,
          // 再次点选当前项不触发回调，免得重复保存同一个偏好
          onClick: () => {
            if (sort !== sortBy) onSortByChange(sort)
          },
        }))}
      />
      <ToolMenu
        label={t(`filter.${visibilityFilter}`, visibilityFilter)}
        icon={<VisibilityIcon filter={visibilityFilter} />}
        active={visibilityFilter !== 'all'}
        items={VISIBILITY_FILTERS.map((filter) => ({
          label: t(`filter.${filter}`, filter),
          icon: <VisibilityIcon filter={filter} />,
          selected: filter === visibilityFilter,
          onClick: () => {
            if (filter !== visibilityFilter) onVisibilityChange(filter)
          },
        }))}
      />
      <ToolMenu
        label={t(`viewMode.${viewMode}`, viewMode)}
        icon={<ViewModeIcon mode={viewMode} />}
        items={availableViewModes.map((mode) => ({
          label: t(`viewMode.${mode}`, mode),
          icon: <ViewModeIcon mode={mode} />,
          selected: mode === viewMode,
          onClick: () => {
            if (mode !== viewMode) onViewModeChange(mode)
          },
        }))}
      />
    </>
  )

  return (
    <>
      {/* Mobile: two-row layout */}
      <div className="flex flex-col gap-3 w-full lg:hidden">
        <div className="flex items-center gap-3 w-full">
          {onOpenTagDrawer && (
            <button
              onClick={onOpenTagDrawer}
              className="group w-11 h-11 rounded-xl flex items-center justify-center transition-all bg-card border border-border hover:bg-muted text-foreground shadow-sm flex-shrink-0"
            >
              <TagIcon className="w-5 h-5" />
            </button>
          )}
          <SearchInput
            searchMode={searchMode}
            onSearchModeToggle={onSearchModeToggle}
            searchKeyword={searchKeyword}
            onSearchKeywordChange={onSearchKeywordChange}
            placeholder={searchMode === 'bookmark' ? t('search.placeholder', t('search.bookmarkPlaceholder', '')) : t('search.tagPlaceholder', '')}
          />
        </div>
        <div className="flex items-center gap-1 w-full sm:w-auto justify-center">
          {toolMenus}
          {extraActions}
        </div>
      </div>

      {/* PC: single-row layout */}
      <div className="hidden lg:flex items-center gap-3 w-full">
        <SearchInput
          searchMode={searchMode}
          onSearchModeToggle={onSearchModeToggle}
          searchKeyword={searchKeyword}
          onSearchKeywordChange={onSearchKeywordChange}
          placeholder={searchMode === 'bookmark' ? t('search.placeholder', t('search.bookmarkPlaceholder', '')) : t('search.tagPlaceholder', '')}
        />
        <div className="flex items-center gap-2 flex-shrink-0">
          {toolMenus}
          {extraActions}
        </div>
      </div>
    </>
  )
}

function SearchInput({
  searchMode,
  onSearchModeToggle,
  searchKeyword,
  onSearchKeywordChange,
  placeholder,
}: {
  searchMode: 'bookmark' | 'tag'
  onSearchModeToggle: () => void
  searchKeyword: string
  onSearchKeywordChange: (v: string) => void
  placeholder: string
}) {
  return (
    <div className="flex-1 min-w-0">
      <div className="relative w-full">
        <button
          onClick={onSearchModeToggle}
          className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center transition-all hover:text-primary hover:scale-110"
        >
          {searchMode === 'bookmark' ? <BookmarkIcon className="w-5 h-5" /> : <TagIcon className="w-5 h-5" />}
        </button>
        <Search className="absolute left-10 sm:left-12 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          className="input w-full !pl-16 sm:!pl-[4.5rem] h-11 sm:h-auto text-sm sm:text-base"
          placeholder={placeholder}
          value={searchKeyword}
          onChange={(e) => onSearchKeywordChange(e.target.value)}
        />
      </div>
    </div>
  )
}

/** 工具栏上的单选下拉：按钮显示当前项的图标，点击后列出全部选项 */
function ToolMenu({
  label,
  icon,
  items,
  active,
}: {
  /** 当前项名称，用作按钮的提示与无障碍名称 */
  label: string
  /** 当前项图标 */
  icon: ReactNode
  items: MenuItem[]
  active?: boolean
}) {
  return (
    <DropdownMenu
      trigger={
        <button
          type="button"
          className={`btn btn-sm btn-ghost p-2 flex-shrink-0 ${active ? 'text-primary' : ''}`}
          title={label}
          aria-label={label}
          aria-haspopup="menu"
        >
          {icon}
        </button>
      }
      items={items}
    />
  )
}
