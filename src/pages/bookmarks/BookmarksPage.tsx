import { useMemo, useEffect, useCallback } from 'react'
import { PluginSlot } from '@/plugins/PluginSlot'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CheckCircle, CheckSquare, Plus, Trash2 } from 'lucide-react'
import { BookmarkForm } from '@/components/bookmarks/BookmarkForm'
import { BatchActionBar } from '@/components/bookmarks/BatchActionBar'
import { BookmarkListLayout } from '@/components/bookmarks/BookmarkListLayout'
import { BatchSelectionPrompt } from './components/BatchSelectionPrompt'
import { useBookmarksState } from './hooks/useBookmarksState'
import { useBookmarksEffects } from './hooks/useBookmarksEffects'
import { useInfiniteBookmarks } from '@/hooks/useBookmarks'
import { useTags } from '@/hooks/useTags'
import { usePreferences } from '@/hooks/usePreferences'
import type { Bookmark, BookmarkQueryParams } from '@/lib/types'
import { CORE_VIEW_MODES, PLUGIN_VIEW_MODES, STANDARD_VIEW_MODES } from '@/lib/constants/bookmarks'
import { availableLayouts, useRunningLayoutPlugins } from '@/plugins/layouts'
import { DESKTOP_ONLY_SHELLS, shellPluginId, usePageShell } from '@/plugins/shells'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { HOME_SHELL_VIEWS } from '../../../plugins/builtin/shells/registry'
import { ShellSwitcher } from '../../../plugins/builtin/shells/ShellSwitcher'

export function BookmarksPage() {
  const { t } = useTranslation('bookmarks')
  const state = useBookmarksState()
  const {
    selectedTags,
    setSelectedTags,
    debouncedSelectedTags,
    searchKeyword,
    setSearchKeyword,
    debouncedSearchKeyword,
    searchMode,
    setSearchMode,
    sortBy,
    setSortBy,
    handleSortChange,
    viewMode,
    setViewMode,
    handleViewModeChange,
    visibilityFilter,
    handleVisibilityChange,
    tagLayout,
    setTagLayout,
    handleTagLayoutChange,
    tagSortBy,
    setTagSortBy,
    showForm,
    setShowForm,
    editingBookmark,
    setEditingBookmark,
    batchMode,
    setBatchMode,
    selectedIds,
    setSelectedIds,
    sortByInitialized,
    setSortByInitialized,
    previousCountRef,
    autoCleanupTimerRef,
  } = state

  const { handleViewModeSync, handleSortSync, handleTagLayoutSync, handleTagSortSync } =
    useBookmarksEffects({
      selectedTags,
      setSelectedTags,
      searchKeyword,
      setSearchKeyword,
      setViewMode,
      setTagLayout,
      setTagSortBy,
      setSortBy,
      sortByInitialized,
      setSortByInitialized,
      autoCleanupTimerRef,
    })

  const queryParams = useMemo<BookmarkQueryParams>(() => {
    const params: BookmarkQueryParams = { sort: sortBy }
    if (searchMode === 'bookmark' && debouncedSearchKeyword.trim()) {
      params.keyword = debouncedSearchKeyword.trim()
    }
    if (debouncedSelectedTags.length > 0) {
      params.tags = debouncedSelectedTags.join(',')
    }
    if (visibilityFilter !== 'all') {
      params.public = visibilityFilter === 'public'
    }
    return params
  }, [searchMode, debouncedSearchKeyword, debouncedSelectedTags, sortBy, visibilityFilter])

  const bookmarksQuery = useInfiniteBookmarks(queryParams)
  const { refetch: refetchTags } = useTags()
  const { data: preferences } = usePreferences()
  const collectibleEnabled = preferences?.experimental_hover_card_enabled ?? false
  const runningLayouts = useRunningLayoutPlugins()
  const availableViewModes = useMemo(
    () =>
      availableLayouts(
        collectibleEnabled ? CORE_VIEW_MODES : STANDARD_VIEW_MODES,
        PLUGIN_VIEW_MODES,
        'view-',
        runningLayouts
      ),
    [collectibleEnabled, runningLayouts]
  )
  // 布局插件停用时回到卡片视图，但不改写已保存的选择，重新启用后恢复
  const activeViewMode = availableViewModes.includes(viewMode) ? viewMode : 'card'

  // 页面版式插件接管整页骨架；需要桌面宽度的版式在窄屏下退回默认骨架
  const shell = usePageShell('home')
  const isDesktop = useIsDesktop()
  const Layout =
    shell.active !== 'default' &&
    (isDesktop || !DESKTOP_ONLY_SHELLS.includes(shellPluginId('home', shell.active)))
      ? HOME_SHELL_VIEWS[shell.active]
      : BookmarkListLayout

  useEffect(() => {
    if (preferences && !collectibleEnabled && viewMode === 'collectible') {
      setViewMode('card')
      handleViewModeSync('card')
    }
  }, [collectibleEnabled, handleViewModeSync, preferences, setViewMode, viewMode])

  const bookmarks = useMemo(() => {
    if (!bookmarksQuery.data?.pages?.length) return [] as Bookmark[]
    const uniqueMap = new Map<string, Bookmark>()
    bookmarksQuery.data.pages
      .flatMap((p) => p.bookmarks)
      .forEach((b) => {
        const existing = uniqueMap.get(b.id)
        if (!existing || (b.tags?.length ?? 0) > (existing.tags?.length ?? 0)) {
          uniqueMap.set(b.id, b)
        } else if ((b.tags?.length ?? 0) === (existing.tags?.length ?? 0)) {
          uniqueMap.set(b.id, { ...existing, ...b })
        }
      })
    return Array.from(uniqueMap.values())
  }, [bookmarksQuery.data])

  // 防抖尚未完成时，上一组筛选的候选不能用于当前选择。
  const serverRelatedTagIds = useMemo(
    () =>
      selectedTags.join(',') === debouncedSelectedTags.join(',')
        ? bookmarksQuery.data?.pages?.[0]?.meta?.related_tag_ids
        : [],
    [bookmarksQuery.data?.pages, selectedTags, debouncedSelectedTags]
  )

  const filteredBookmarks = useMemo(() => {
    if (visibilityFilter === 'all') return bookmarks
    return bookmarks.filter((b) => (visibilityFilter === 'public' ? b.is_public : !b.is_public))
  }, [bookmarks, visibilityFilter])

  const handleOpenForm = useCallback(
    (bookmark?: Bookmark) => {
      setEditingBookmark(bookmark || null)
      setShowForm(true)
    },
    [setEditingBookmark, setShowForm]
  )

  const isInitialLoading = bookmarksQuery.isLoading && bookmarks.length === 0
  useEffect(() => {
    if (filteredBookmarks.length > 0) previousCountRef.current = filteredBookmarks.length
  }, [filteredBookmarks.length, previousCountRef])

  const extraActions = (
    <>
      <button
        onClick={() => {
          setBatchMode(!batchMode)
          if (batchMode) setSelectedIds([])
        }}
        className={`btn btn-sm p-2 flex-shrink-0 ${batchMode ? 'btn-primary' : 'btn-ghost'}`}
        title={batchMode ? t('toolbar.exitBatchMode') : t('toolbar.batchMode')}
      >
        <CheckCircle className="w-4 h-4 lg:hidden" />
        <CheckSquare className="w-5 h-5 hidden lg:block" />
      </button>
      <Link
        to="/bookmarks/trash"
        className="btn btn-sm btn-ghost p-2 flex-shrink-0"
        title={t('toolbar.trash')}
      >
        <Trash2 className="w-4 h-4 lg:w-5 lg:h-5" />
      </Link>
      <ShellSwitcher
        page="home"
        active={shell.active}
        available={shell.available}
        onSelect={shell.select}
        className="btn btn-sm btn-ghost p-2 flex-shrink-0"
      />
      <button
        onClick={() => handleOpenForm()}
        className="btn btn-sm btn-primary p-2 flex-shrink-0"
        title={t('toolbar.addBookmark')}
      >
        <Plus className="w-4 h-4 lg:w-5 lg:h-5" strokeWidth={2.5} />
      </button>
    </>
  )

  return (
    <>
      <Layout
        fullScreen
        bookmarks={filteredBookmarks}
        isLoading={isInitialLoading}
        isError={bookmarksQuery.isError}
        onRetry={() => bookmarksQuery.refetch()}
        hasMore={bookmarksQuery.hasNextPage ?? false}
        isFetchingMore={bookmarksQuery.isFetchingNextPage}
        onLoadMore={() => bookmarksQuery.fetchNextPage()}
        totalLoaded={bookmarks.length}
        searchMode={searchMode}
        onSearchModeToggle={() => setSearchMode(searchMode === 'bookmark' ? 'tag' : 'bookmark')}
        searchKeyword={searchKeyword}
        onSearchKeywordChange={setSearchKeyword}
        sortBy={sortBy}
        onSortByChange={(sort) => handleSortSync(handleSortChange(sort))}
        visibilityFilter={visibilityFilter}
        onVisibilityChange={handleVisibilityChange}
        viewMode={activeViewMode}
        onViewModeChange={(mode) => handleViewModeSync(handleViewModeChange(mode))}
        availableViewModes={availableViewModes}
        selectedTags={selectedTags}
        settledSelectedTags={debouncedSelectedTags}
        onTagsChange={setSelectedTags}
        showTagIcons={preferences?.show_tag_icons ?? true}
        tagLayout={tagLayout}
        onTagLayoutChange={(l) => {
          handleTagLayoutChange(l)
          handleTagLayoutSync(l)
        }}
        tagSortBy={tagSortBy}
        onTagSortChange={(nextSort) => {
          setTagSortBy(nextSort)
          handleTagSortSync(nextSort)
        }}
        debouncedSearchKeyword={debouncedSearchKeyword}
        relatedTagIds={serverRelatedTagIds}
        batchMode={batchMode}
        selectedIds={selectedIds}
        onToggleSelect={(id) =>
          setSelectedIds((p) => (p.includes(id) ? p.filter((i) => i !== id) : [...p, id]))
        }
        onEdit={handleOpenForm}
        extraActions={
          <>
            {extraActions}
            <PluginSlot name="bookmark-actions" actions />
          </>
        }
        selectionPromptSlot={
          <BatchSelectionPrompt
            batchMode={batchMode}
            selectedCount={selectedIds.length}
            totalCount={filteredBookmarks.length}
            onSelectAll={() => setSelectedIds(filteredBookmarks.map((b) => b.id))}
            onClearSelection={() => {
              setSelectedIds([])
              setBatchMode(false)
            }}
          />
        }
        footerSlot={
          <>
            {showForm && (
              <BookmarkForm
                bookmark={editingBookmark}
                onClose={() => setShowForm(false)}
                onSuccess={() => {
                  bookmarksQuery.refetch()
                  refetchTags()
                }}
              />
            )}
            {batchMode && selectedIds.length > 0 && (
              <BatchActionBar
                selectedIds={selectedIds}
                onClearSelection={() => {
                  setSelectedIds([])
                  setBatchMode(false)
                }}
                onSuccess={() => {
                  setSelectedIds([])
                  setBatchMode(false)
                  bookmarksQuery.refetch()
                  refetchTags()
                }}
              />
            )}
          </>
        }
      />
    </>
  )
}
