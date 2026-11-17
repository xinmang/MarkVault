/**
 * 统一书签列表布局
 * 公开分享页和私有书签页共享的骨架组件
 * 包含: TagSidebar + SearchToolbar + BookmarkListContainer + PaginationFooter + MobileTagDrawer
 */

import { ReactNode, useCallback, useState } from 'react'
import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { TagSidebar } from '@/components/tags/TagSidebar'
import { BookmarkListContainer } from '@/components/bookmarks/BookmarkListContainer'
import { TagLinkageRoot } from '@/components/bookmarks/TagLinkage'
import { PaginationFooter } from '@/components/common/PaginationFooter'
import { SearchToolbar } from '@/components/common/SearchToolbar'
import { MobileTagDrawer } from '@/pages/bookmarks/components/MobileTagDrawer'
import type { Bookmark, Tag, TagSortPreference } from '@/lib/types'
import type { TagLayout, ViewMode, VisibilityFilter } from '@/lib/constants/bookmarks'
import type { SortOption } from '@/components/common/SortSelector'
import { useExperimentalFeatures } from '@/contexts/ExperimentalFeaturesContext'
import { useRecordTagClick } from '@/hooks/useClickTracking'

export interface BookmarkListLayoutProps {
  /* ---- 数据 ---- */
  bookmarks: Bookmark[]
  /** 传给 TagSidebar 的书签（可能是过滤后的子集） */
  tagBookmarks?: Bookmark[]
  isLoading: boolean
  isError?: boolean
  onRetry?: () => void

  /* ---- 分页 ---- */
  hasMore: boolean
  isFetchingMore?: boolean
  onLoadMore: () => void
  totalLoaded?: number

  /* ---- 搜索/过滤 ---- */
  searchMode: 'bookmark' | 'tag'
  onSearchModeToggle: () => void
  searchKeyword: string
  onSearchKeywordChange: (kw: string) => void
  sortBy: SortOption
  onSortByChange: (sort: SortOption) => void
  visibilityFilter: VisibilityFilter
  onVisibilityChange: (filter: VisibilityFilter) => void
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  /** 当前可切换的视图（核心视图加正在运行的布局插件），视图菜单只列这些 */
  availableViewModes: readonly ViewMode[]

  /* ---- 标签 ---- */
  selectedTags: string[]
  settledSelectedTags?: string[]
  onTagsChange: (tags: string[]) => void
  tagLayout: TagLayout
  showTagIcons?: boolean
  onTagLayoutChange: (l: TagLayout) => void
  tagSortBy: TagSortPreference
  onTagSortChange: (sort: TagSortPreference) => void
  debouncedSearchKeyword?: string

  /* ---- 标签侧栏（公开模式的额外配置） ---- */
  readOnly?: boolean
  availableTags?: Tag[]
  relatedTagIds?: string[]

  /* ---- 批量操作（仅私有页面） ---- */
  batchMode?: boolean
  selectedIds?: string[]
  onToggleSelect?: (id: string) => void
  onEdit?: (bookmark: Bookmark) => void

  /* ---- 插槽 ---- */
  /** 搜索栏右侧额外按钮（批量/回收站/添加） */
  extraActions?: ReactNode
  /** 搜索栏上方的内容（分享头部卡片等） */
  headerSlot?: ReactNode
  /** 列表下方的内容（批量操作栏、表单弹窗等） */
  footerSlot?: ReactNode
  /** 批量选中提示栏 */
  selectionPromptSlot?: ReactNode

  /* ---- 布局 ---- */
  /** 是否使用全屏固定高度布局（私有页面 true，公开页面 false） */
  fullScreen?: boolean
  /** i18n namespace */
  i18nNs?: string
}

export function BookmarkListLayout({
  bookmarks,
  tagBookmarks,
  isLoading,
  isError,
  onRetry,
  hasMore,
  isFetchingMore,
  onLoadMore,
  totalLoaded,
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
  selectedTags,
  settledSelectedTags,
  onTagsChange,
  tagLayout,
  onTagLayoutChange,
  showTagIcons = true,
  tagSortBy,
  onTagSortChange,
  debouncedSearchKeyword,
  readOnly,
  availableTags,
  relatedTagIds,
  batchMode,
  selectedIds,
  onToggleSelect,
  onEdit,
  extraActions,
  headerSlot,
  footerSlot,
  selectionPromptSlot,
  fullScreen = false,
  i18nNs = 'bookmarks',
}: BookmarkListLayoutProps) {
  const { t } = useTranslation(i18nNs)
  const [isTagSidebarOpen, setIsTagSidebarOpen] = useState(false)
  const recordTagClick = useRecordTagClick(readOnly)
  const { motion } = useExperimentalFeatures()
  const sidebarBookmarks = tagBookmarks ?? bookmarks
  const shuffleKey = selectedTags.join('\u001f')
  const settledShuffleKey = (settledSelectedTags ?? selectedTags).join('\u001f')

  // 点击卡片上的标签与点击侧栏标签一致：切换筛选，选中时记录一次标签点击
  const toggleTagFromCard = useCallback(
    (tagId: string) => {
      const selecting = !selectedTags.includes(tagId)
      onTagsChange(selecting ? [...selectedTags, tagId] : selectedTags.filter((id) => id !== tagId))
      if (selecting) void recordTagClick(tagId)
    },
    [onTagsChange, recordTagClick, selectedTags]
  )

  const wrapperClass = fullScreen
    ? 'w-full h-[calc(100dvh-4rem)] sm:h-[calc(100dvh-5rem)] flex flex-col overflow-hidden touch-none'
    : 'w-full mx-auto py-3 sm:py-4 md:py-6 px-3 sm:px-4 md:px-6'

  const mainClass = fullScreen
    ? 'lg:col-span-9 lg:col-start-4 flex flex-col h-full overflow-hidden w-full min-w-0'
    : 'lg:col-span-9 lg:col-start-4'

  return (
    <TagLinkageRoot
      className={wrapperClass}
      enabled={motion.enabled && motion.tagLinkage}
      selectedTags={selectedTags}
      onToggleTag={batchMode ? undefined : toggleTagFromCard}
    >
      <div
        className={`grid grid-cols-1 lg:grid-cols-12 ${fullScreen ? 'gap-0 lg:gap-6 w-full h-full overflow-hidden' : 'gap-3 sm:gap-4 md:gap-6'}`}
      >
        {/* 左侧标签栏 */}
        <aside className="hidden lg:block lg:col-span-3 fixed top-[calc(5rem+0.75rem)] left-3 sm:left-4 md:left-6 bottom-3 w-[calc(25%-1.5rem)] z-40">
          <TagSidebar
            selectedTags={selectedTags}
            onTagsChange={onTagsChange}
            bookmarks={sidebarBookmarks}
            isLoadingBookmarks={isLoading}
            tagLayout={tagLayout}
            onTagLayoutChange={onTagLayoutChange}
            showTagIcons={showTagIcons}
            tagSortBy={tagSortBy}
            onTagSortChange={onTagSortChange}
            readOnly={readOnly}
            availableTags={availableTags}
            relatedTagIds={relatedTagIds}
            searchQuery={searchMode === 'tag' ? (debouncedSearchKeyword ?? searchKeyword) : ''}
          />
        </aside>

        <main className={mainClass}>
          {fullScreen ? (
            <FullScreenContent
              headerSlot={headerSlot}
              selectionPromptSlot={selectionPromptSlot}
              searchMode={searchMode}
              onSearchModeToggle={onSearchModeToggle}
              searchKeyword={searchKeyword}
              onSearchKeywordChange={onSearchKeywordChange}
              sortBy={sortBy}
              onSortByChange={onSortByChange}
              visibilityFilter={visibilityFilter}
              onVisibilityChange={onVisibilityChange}
              viewMode={viewMode}
              onViewModeChange={onViewModeChange}
              availableViewModes={availableViewModes}
              extraActions={extraActions}
              i18nNs={i18nNs}
              onOpenTagDrawer={() => setIsTagSidebarOpen(true)}
              bookmarks={bookmarks}
              isLoading={isLoading}
              isError={isError}
              onRetry={onRetry}
              hasMore={hasMore}
              isFetchingMore={isFetchingMore}
              onLoadMore={onLoadMore}
              totalLoaded={totalLoaded}
              batchMode={batchMode}
              selectedIds={selectedIds}
              onToggleSelect={onToggleSelect}
              onEdit={onEdit}
              readOnly={readOnly}
              shuffleKey={shuffleKey}
              settledShuffleKey={settledShuffleKey}
            />
          ) : (
            <FlowContent
              headerSlot={headerSlot}
              searchMode={searchMode}
              onSearchModeToggle={onSearchModeToggle}
              searchKeyword={searchKeyword}
              onSearchKeywordChange={onSearchKeywordChange}
              sortBy={sortBy}
              onSortByChange={onSortByChange}
              visibilityFilter={visibilityFilter}
              onVisibilityChange={onVisibilityChange}
              viewMode={viewMode}
              onViewModeChange={onViewModeChange}
              availableViewModes={availableViewModes}
              extraActions={extraActions}
              i18nNs={i18nNs}
              onOpenTagDrawer={() => setIsTagSidebarOpen(true)}
              bookmarks={bookmarks}
              isLoading={isLoading}
              hasMore={hasMore}
              onLoadMore={onLoadMore}
              readOnly={readOnly}
              shuffleKey={shuffleKey}
              settledShuffleKey={settledShuffleKey}
              t={t}
            />
          )}
        </main>
      </div>

      <MobileTagDrawer
        isOpen={isTagSidebarOpen}
        onClose={() => setIsTagSidebarOpen(false)}
        selectedTags={selectedTags}
        onTagsChange={onTagsChange}
        tagLayout={tagLayout}
        onTagLayoutChange={onTagLayoutChange}
        showTagIcons={showTagIcons}
        tagSortBy={tagSortBy}
        onTagSortChange={onTagSortChange}
        bookmarks={sidebarBookmarks}
        isLoading={isLoading}
        searchMode={searchMode}
        searchKeyword={debouncedSearchKeyword ?? searchKeyword}
        relatedTagIds={relatedTagIds}
        readOnly={readOnly}
        availableTags={availableTags}
      />

      {footerSlot}
    </TagLinkageRoot>
  )
}

/** 全屏固定高度模式（私有书签页面） */
function FullScreenContent(props: {
  headerSlot?: ReactNode
  selectionPromptSlot?: ReactNode
  searchMode: 'bookmark' | 'tag'
  onSearchModeToggle: () => void
  searchKeyword: string
  onSearchKeywordChange: (kw: string) => void
  sortBy: SortOption
  onSortByChange: (sort: SortOption) => void
  visibilityFilter: VisibilityFilter
  onVisibilityChange: (filter: VisibilityFilter) => void
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  availableViewModes: readonly ViewMode[]
  extraActions?: ReactNode
  i18nNs: string
  onOpenTagDrawer: () => void
  bookmarks: Bookmark[]
  isLoading: boolean
  isError?: boolean
  onRetry?: () => void
  hasMore: boolean
  isFetchingMore?: boolean
  onLoadMore: () => void
  totalLoaded?: number
  batchMode?: boolean
  selectedIds?: string[]
  onToggleSelect?: (id: string) => void
  onEdit?: (b: Bookmark) => void
  readOnly?: boolean
  shuffleKey: string
  settledShuffleKey: string
}) {
  return (
    <>
      <div className="flex-shrink-0 px-3 sm:px-4 md:px-6 pt-3 sm:pt-4 md:pt-6 pb-0 sm:pb-1 w-full">
        {props.headerSlot}
        <div className="p-4 sm:p-5 w-full">
          <SearchToolbar
            searchMode={props.searchMode}
            onSearchModeToggle={props.onSearchModeToggle}
            searchKeyword={props.searchKeyword}
            onSearchKeywordChange={props.onSearchKeywordChange}
            sortBy={props.sortBy}
            onSortByChange={props.onSortByChange}
            visibilityFilter={props.visibilityFilter}
            onVisibilityChange={props.onVisibilityChange}
            viewMode={props.viewMode}
            onViewModeChange={props.onViewModeChange}
            availableViewModes={props.availableViewModes}
            onOpenTagDrawer={props.onOpenTagDrawer}
            extraActions={props.extraActions}
            i18nNs={props.i18nNs}
          />
        </div>
      </div>
      {props.selectionPromptSlot}
      {/* 顶部留白属于滚动区域：首行书签悬停上浮、联动与选中描边不会被裁掉 */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-4 md:px-6 pt-3 pb-20 sm:pb-4 md:pb-6 w-full overscroll-contain">
        <BookmarkResults {...props} />
      </div>
    </>
  )
}

/** 结果区：加载失败提示，或书签列表加“加载更多”。默认骨架与页面版式插件共用。 */
export function BookmarkResults(props: {
  bookmarks: Bookmark[]
  viewMode: ViewMode
  isLoading: boolean
  isError?: boolean
  onRetry?: () => void
  hasMore: boolean
  isFetchingMore?: boolean
  onLoadMore: () => void
  totalLoaded?: number
  batchMode?: boolean
  selectedIds?: string[]
  onToggleSelect?: (id: string) => void
  onEdit?: (b: Bookmark) => void
  readOnly?: boolean
  shuffleKey: string
  settledShuffleKey: string
}) {
  const { t } = useTranslation('common')
  if (props.isError) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-4 py-16 text-center"
        role="alert"
      >
        <p style={{ color: 'var(--destructive)' }}>{t('status.loadFailed')}</p>
        {props.onRetry && (
          <button type="button" onClick={props.onRetry} className="btn btn-sm btn-secondary">
            {t('button.retry')}
          </button>
        )}
      </div>
    )
  }
  return (
    <>
      <BookmarkListContainer
        bookmarks={props.bookmarks}
        viewMode={props.viewMode}
        onEdit={props.readOnly ? undefined : props.onEdit}
        isLoading={props.isLoading}
        readOnly={props.readOnly}
        batchMode={props.batchMode}
        selectedIds={props.selectedIds}
        onToggleSelect={props.onToggleSelect}
        shuffleKey={props.shuffleKey}
        settledShuffleKey={props.settledShuffleKey}
      />
      {!props.isLoading && props.bookmarks.length > 0 && (
        <PaginationFooter
          hasMore={props.hasMore}
          isLoading={props.isFetchingMore || false}
          onLoadMore={props.onLoadMore}
          currentCount={props.bookmarks.length}
          totalLoaded={props.totalLoaded ?? props.bookmarks.length}
        />
      )}
    </>
  )
}

/** 流式布局模式（公开分享页面） */
function FlowContent(props: {
  headerSlot?: ReactNode
  searchMode: 'bookmark' | 'tag'
  onSearchModeToggle: () => void
  searchKeyword: string
  onSearchKeywordChange: (kw: string) => void
  sortBy: SortOption
  onSortByChange: (sort: SortOption) => void
  visibilityFilter: VisibilityFilter
  onVisibilityChange: (filter: VisibilityFilter) => void
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  availableViewModes: readonly ViewMode[]
  extraActions?: ReactNode
  i18nNs: string
  onOpenTagDrawer: () => void
  bookmarks: Bookmark[]
  isLoading: boolean
  hasMore: boolean
  onLoadMore: () => void
  readOnly?: boolean
  shuffleKey: string
  settledShuffleKey: string
  t: (key: string) => string
}) {
  const { hoverCard } = useExperimentalFeatures()
  const holdCollectibleDuringShuffle =
    props.viewMode === 'collectible' && hoverCard.enabled && hoverCard.shuffleEnabled

  return (
    <div className="space-y-3 sm:space-y-4 md:space-y-5">
      {props.headerSlot}
      <div className="p-4 sm:p-5 card bg-card/50">
        <SearchToolbar
          searchMode={props.searchMode}
          onSearchModeToggle={props.onSearchModeToggle}
          searchKeyword={props.searchKeyword}
          onSearchKeywordChange={props.onSearchKeywordChange}
          sortBy={props.sortBy}
          onSortByChange={props.onSortByChange}
          visibilityFilter={props.visibilityFilter}
          onVisibilityChange={props.onVisibilityChange}
          viewMode={props.viewMode}
          onViewModeChange={props.onViewModeChange}
          availableViewModes={props.availableViewModes}
          onOpenTagDrawer={props.onOpenTagDrawer}
          extraActions={props.extraActions}
          i18nNs={props.i18nNs}
        />
      </div>
      {props.bookmarks.length > 0 || holdCollectibleDuringShuffle ? (
        <>
          <BookmarkListContainer
            bookmarks={props.bookmarks}
            viewMode={props.viewMode}
            readOnly={props.readOnly}
            isLoading={props.isLoading}
            shuffleKey={props.shuffleKey}
            settledShuffleKey={props.settledShuffleKey}
          />
          {props.bookmarks.length > 0 && (
            <PaginationFooter
              hasMore={props.hasMore}
              isLoading={false}
              onLoadMore={props.onLoadMore}
              currentCount={props.bookmarks.length}
              totalLoaded={props.bookmarks.length}
            />
          )}
        </>
      ) : !props.isLoading ? (
        <div className="card text-center py-12">
          <Search className="w-16 h-16 mx-auto mb-4 opacity-20 text-muted-foreground" />
          <p className="text-lg font-medium text-muted-foreground">{props.t('empty.title')}</p>
          <p className="text-sm mt-2 text-muted-foreground">{props.t('empty.hint')}</p>
        </div>
      ) : null}
    </div>
  )
}
