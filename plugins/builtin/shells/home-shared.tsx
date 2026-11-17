/* eslint-disable react-refresh/only-export-components */
import { useCallback, useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Tags, X } from 'lucide-react'
import type { Bookmark, Tag } from '@/lib/types'
import { useTags } from '@/hooks/useTags'
import { useRecordTagClick } from '@/hooks/useClickTracking'
import { useExperimentalFeatures } from '@/contexts/ExperimentalFeaturesContext'
import { sortTags, useTagFiltering } from '@/components/tags/useTagFiltering'
import { TagLinkageRoot } from '@/components/bookmarks/TagLinkage'
import { SearchToolbar } from '@/components/common/SearchToolbar'
import {
  BookmarkResults,
  type BookmarkListLayoutProps,
} from '@/components/bookmarks/BookmarkListLayout'
import { MobileTagDrawer } from '@/pages/bookmarks/components/MobileTagDrawer'
import type { PluginHomeShell } from '@/plugins/shells'
import { TagButton } from '../layouts/TagButton'
import type { BookmarkEntryProps } from '../layouts/shared'
import './style.css'

/**
 * 首页版式插件收到的属性与默认骨架完全相同：数据、筛选状态、回调和插槽。
 * 版式自己决定这些内容放在页面的什么位置，也可以完全不用其中一部分。
 */
export type HomeShellProps = BookmarkListLayoutProps

/** 版式根节点：占满页头以下的视口，保留标签与书签联动，并挂载弹窗与批量操作栏。 */
export function HomeShellRoot({
  name,
  shell,
  children,
}: {
  name: PluginHomeShell
  shell: HomeShellProps
  children: ReactNode
}) {
  const { motion } = useExperimentalFeatures()
  const recordTagClick = useRecordTagClick(shell.readOnly)
  const { selectedTags, onTagsChange } = shell
  const toggleTagFromCard = useCallback(
    (tagId: string) => {
      const selecting = !selectedTags.includes(tagId)
      onTagsChange(selecting ? [...selectedTags, tagId] : selectedTags.filter((id) => id !== tagId))
      if (selecting) void recordTagClick(tagId)
    },
    [onTagsChange, recordTagClick, selectedTags]
  )
  return (
    <TagLinkageRoot
      className={'pshell pshell--' + name}
      enabled={motion.enabled && motion.tagLinkage}
      selectedTags={selectedTags}
      onToggleTag={shell.batchMode ? undefined : toggleTagFromCard}
    >
      {children}
      {shell.footerSlot}
    </TagLinkageRoot>
  )
}

/** 与标签栏相同的数据：按当前排序排好，并分出已选、可继续筛选和其他标签。 */
export function useShellTags(shell: HomeShellProps) {
  const { availableTags, tagSortBy, selectedTags, onTagsChange, readOnly } = shell
  const { data, isLoading } = useTags({ sort: tagSortBy }, { enabled: !availableTags })
  const recordTagClick = useRecordTagClick(readOnly)
  const sorted = useMemo(
    () => sortTags(availableTags || data?.tags || [], tagSortBy),
    [availableTags, data?.tags, tagSortBy]
  )
  const { orderedTags, relatedTagIds } = useTagFiltering(
    sorted,
    shell.tagBookmarks ?? shell.bookmarks,
    selectedTags,
    shell.searchMode === 'tag' ? (shell.debouncedSearchKeyword ?? shell.searchKeyword) : '',
    shell.relatedTagIds
  )
  const toggle = useCallback(
    (tagId: string) => {
      const selecting = !selectedTags.includes(tagId)
      if (selecting) void recordTagClick(tagId)
      onTagsChange(selecting ? [...selectedTags, tagId] : selectedTags.filter((id) => id !== tagId))
    },
    [onTagsChange, recordTagClick, selectedTags]
  )
  return {
    tags: orderedTags,
    relatedTagIds,
    isLoading: availableTags ? false : isLoading,
    toggle,
    /** 直接展开到 TagButton / ShellTagChip 上的公共属性 */
    chip: {
      selectedTags,
      relatedTagIds,
      showIcons: shell.showTagIcons ?? true,
      onToggle: toggle,
    },
  }
}

export type ShellTags = ReturnType<typeof useShellTags>

/** 标签芯片：名称加书签数量，保留联动、选中和待选状态。 */
export function ShellTagChip({ tag, chip }: { tag: Tag; chip: ShellTags['chip'] }) {
  return (
    <TagButton tag={tag} className="pshell-chip" {...chip}>
      <span className="pshell-chip__name">{tag.name}</span>
      {tag.bookmark_count !== undefined && (
        <span className="pshell-chip__count">{tag.bookmark_count}</span>
      )}
    </TagButton>
  )
}

/** 打开完整标签面板（排序、布局、新建与管理）的按钮。 */
export function ShellAllTagsButton({
  onClick,
  label = true,
}: {
  onClick: () => void
  label?: boolean
}) {
  const { t } = useTranslation('plugins')
  return (
    <button
      type="button"
      className="pshell-pill"
      onClick={onClick}
      title={t('shells.allTags')}
      aria-label={t('shells.allTags')}
    >
      <Tags size={14} aria-hidden="true" />
      {label && <span>{t('shells.allTags')}</span>}
    </button>
  )
}

/** 已选标签时出现的“清除筛选”按钮。 */
export function ShellClearTagsButton({ shell }: { shell: HomeShellProps }) {
  const { t } = useTranslation('plugins')
  if (shell.selectedTags.length === 0) return null
  return (
    <button type="button" className="pshell-pill" onClick={() => shell.onTagsChange([])}>
      <X size={14} aria-hidden="true" />
      <span>{t('shells.clearTags', { count: shell.selectedTags.length })}</span>
    </button>
  )
}

/** 没有常驻标签栏的版式用抽屉提供完整的标签面板。 */
export function ShellTagPanel({
  shell,
  isOpen,
  onClose,
}: {
  shell: HomeShellProps
  isOpen: boolean
  onClose: () => void
}) {
  return (
    <MobileTagDrawer
      allScreens
      isOpen={isOpen}
      onClose={onClose}
      selectedTags={shell.selectedTags}
      onTagsChange={shell.onTagsChange}
      tagLayout={shell.tagLayout}
      onTagLayoutChange={shell.onTagLayoutChange}
      showTagIcons={shell.showTagIcons}
      tagSortBy={shell.tagSortBy}
      onTagSortChange={shell.onTagSortChange}
      bookmarks={shell.tagBookmarks ?? shell.bookmarks}
      isLoading={shell.isLoading}
      searchMode={shell.searchMode}
      searchKeyword={shell.debouncedSearchKeyword ?? shell.searchKeyword}
      relatedTagIds={shell.relatedTagIds}
      readOnly={shell.readOnly}
      availableTags={shell.availableTags}
    />
  )
}

/** 搜索框加排序、可见性、视图和页面操作按钮。 */
export function ShellToolbar({
  shell,
  onOpenTags,
}: {
  shell: HomeShellProps
  /** 传入后，手机宽度下搜索框前会出现打开标签面板的按钮 */
  onOpenTags?: () => void
}) {
  return (
    <SearchToolbar
      searchMode={shell.searchMode}
      onSearchModeToggle={shell.onSearchModeToggle}
      searchKeyword={shell.searchKeyword}
      onSearchKeywordChange={shell.onSearchKeywordChange}
      sortBy={shell.sortBy}
      onSortByChange={shell.onSortByChange}
      visibilityFilter={shell.visibilityFilter}
      onVisibilityChange={shell.onVisibilityChange}
      viewMode={shell.viewMode}
      onViewModeChange={shell.onViewModeChange}
      availableViewModes={shell.availableViewModes}
      onOpenTagDrawer={onOpenTags}
      extraActions={shell.extraActions}
      i18nNs={shell.i18nNs}
    />
  )
}

/** 按用户当前选择的视图渲染书签，并附带加载失败提示和“加载更多”。 */
export function ShellResults({ shell }: { shell: HomeShellProps }) {
  return (
    <BookmarkResults
      bookmarks={shell.bookmarks}
      viewMode={shell.viewMode}
      isLoading={shell.isLoading}
      isError={shell.isError}
      onRetry={shell.onRetry}
      hasMore={shell.hasMore}
      isFetchingMore={shell.isFetchingMore}
      onLoadMore={shell.onLoadMore}
      totalLoaded={shell.totalLoaded}
      batchMode={shell.batchMode}
      selectedIds={shell.selectedIds}
      onToggleSelect={shell.onToggleSelect}
      onEdit={shell.onEdit}
      readOnly={shell.readOnly}
      shuffleKey={shell.selectedTags.join('\u001f')}
      settledShuffleKey={(shell.settledSelectedTags ?? shell.selectedTags).join('\u001f')}
    />
  )
}

/** 版式自绘书签条目时，用它得到与核心视图一致的打开、勾选与编辑行为。 */
export function shellEntryProps(shell: HomeShellProps, bookmark: Bookmark): BookmarkEntryProps {
  return {
    bookmark,
    isSelected: shell.selectedIds?.includes(bookmark.id) ?? false,
    onEdit: shell.readOnly ? undefined : shell.onEdit,
    readOnly: shell.readOnly,
    batchMode: shell.batchMode,
    onToggleSelect: shell.onToggleSelect,
  }
}

/** 自绘列表底部的紧凑“加载更多”，与核心列表的分页卡片作用相同。 */
export function ShellLoadMore({ shell }: { shell: HomeShellProps }) {
  const { t } = useTranslation('plugins')
  if (shell.isLoading || shell.bookmarks.length === 0) return null
  return (
    <div className="pshell-more">
      <span>{t('shells.loaded', { count: shell.totalLoaded ?? shell.bookmarks.length })}</span>
      {shell.hasMore && (
        <button
          type="button"
          className="btn btn-sm btn-secondary"
          disabled={shell.isFetchingMore}
          onClick={shell.onLoadMore}
        >
          {t(shell.isFetchingMore ? 'shells.loadingMore' : 'shells.loadMore')}
        </button>
      )}
    </div>
  )
}

/** 自绘列表的加载、失败与空状态；有内容可显示时返回 null。 */
export function ShellListState({ shell }: { shell: HomeShellProps }) {
  const { t } = useTranslation(shell.i18nNs ?? 'bookmarks')
  const { t: tc } = useTranslation('common')
  if (shell.isError) {
    return (
      <div className="pshell-state" role="alert">
        <p>{tc('status.loadFailed')}</p>
        {shell.onRetry && (
          <button type="button" className="btn btn-sm btn-secondary" onClick={shell.onRetry}>
            {tc('button.retry')}
          </button>
        )}
      </div>
    )
  }
  if (shell.bookmarks.length > 0) return null
  return (
    <div className="pshell-state" role="status">
      <p>{shell.isLoading ? t('loading') : t('empty.title')}</p>
      {!shell.isLoading && (
        <p className="pshell-state__hint">
          {shell.readOnly ? t('empty.readOnlyDescription') : t('empty.description')}
        </p>
      )}
    </div>
  )
}
