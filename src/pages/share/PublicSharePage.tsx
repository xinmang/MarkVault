import { useCallback, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BookmarkListLayout } from '@/components/bookmarks/BookmarkListLayout'
import { usePublicShare } from '@/hooks/useShare'
import { useBookmarkFilters } from '@/hooks/useBookmarkFilters'
import { useClientSideFilter } from '@/hooks/useClientSideFilter'
import { CORE_VIEW_MODES, STANDARD_VIEW_MODES } from '@/lib/constants/bookmarks'
import type { ViewMode } from '@/lib/constants/bookmarks'
import { ExperimentalFeaturesProvider } from '@/contexts/ExperimentalFeaturesContext'
import { useSiteBranding } from '@/contexts/SiteBrandingContext'
import { PublicShareSlugContext } from '@/contexts/PublicShareSlugContext'

export function PublicSharePage() {
  const { t } = useTranslation('share')
  const { slug = '' } = useParams()
  const { setPageTitle } = useSiteBranding()

  const {
    selectedTags, setSelectedTags,
    debouncedSelectedTags,
    searchKeyword, setSearchKeyword,
    debouncedSearchKeyword,
    searchMode, setSearchMode,
    sortBy, setSortBy, handleSortChange,
    viewMode, setViewMode, handleViewModeChange,
    visibilityFilter, handleVisibilityChange,
    tagLayout, setTagLayout, handleTagLayoutChange,
    tagSortBy, setTagSortBy,
  } = useBookmarkFilters()

  const shareQuery = usePublicShare(slug, true)
  const shareInfo = shareQuery.data?.profile
  const allBookmarks = shareQuery.data?.bookmarks || []
  const tags = shareQuery.data?.tags || []
  const sharePreferences = shareQuery.data?.preferences
  const initializedSlugRef = useRef<string | null>(null)
  const collectibleEnabled = sharePreferences?.experimental_hover_card_enabled ?? false
  const availableViewModes: readonly ViewMode[] = collectibleEnabled ? CORE_VIEW_MODES : STANDARD_VIEW_MODES

  useEffect(() => {
    if (!sharePreferences || initializedSlugRef.current === slug) return
    const preferredViewMode = availableViewModes.includes(sharePreferences.view_mode)
      ? sharePreferences.view_mode
      : 'card'
    setViewMode(preferredViewMode)
    setSortBy(sharePreferences.sort_by)
    setTagLayout(sharePreferences.tag_layout)
    setTagSortBy(sharePreferences.tag_sort_by ?? 'usage')
    initializedSlugRef.current = slug
  }, [availableViewModes, setSortBy, setTagLayout, setTagSortBy, setViewMode, sharePreferences, slug])

  const {
    displayedBookmarks,
    sortedBookmarks,
    hasMore,
    loadMore,
  } = useClientSideFilter({
    bookmarks: allBookmarks,
    selectedTags: debouncedSelectedTags,
    searchKeyword: debouncedSearchKeyword,
    sortBy,
    visibilityFilter,
  })

  const handleSearchModeToggle = useCallback(
    () => setSearchMode(searchMode === 'bookmark' ? 'tag' : 'bookmark'),
    [searchMode, setSearchMode]
  )
  const publicViewMode = availableViewModes.includes(viewMode)
    ? viewMode
    : 'card'

  // 分享页保留自己的内容标题：只覆盖浏览器标题前缀，不改动站点品牌
  const shareTitle = shareQuery.data?.profile?.title?.trim() || ''
  useEffect(() => {
    setPageTitle(shareTitle || null)
    return () => setPageTitle(null)
  }, [shareTitle, setPageTitle])

  if (shareQuery.isLoading) {
    return <div className="text-center text-muted-foreground py-24">{t('loading')}</div>
  }
  if (shareQuery.isError) {
    return <div className="text-center text-muted-foreground py-24">{t('error')}</div>
  }

  return (
    <PublicShareSlugContext.Provider value={slug}>
    <ExperimentalFeaturesProvider preferences={sharePreferences} applyThemeToDocument>
      <BookmarkListLayout
        readOnly
      bookmarks={displayedBookmarks}
      tagBookmarks={sortedBookmarks}
      isLoading={shareQuery.isLoading}
      hasMore={hasMore}
      onLoadMore={loadMore}
      searchMode={searchMode}
      onSearchModeToggle={handleSearchModeToggle}
      searchKeyword={searchKeyword}
      onSearchKeywordChange={setSearchKeyword}
      sortBy={sortBy}
      onSortByChange={handleSortChange}
      visibilityFilter={visibilityFilter}
      onVisibilityChange={handleVisibilityChange}
      viewMode={publicViewMode}
      onViewModeChange={handleViewModeChange}
      availableViewModes={availableViewModes}
      selectedTags={selectedTags}
      settledSelectedTags={debouncedSelectedTags}
      onTagsChange={setSelectedTags}
      showTagIcons={sharePreferences?.show_tag_icons ?? true}
      tagLayout={tagLayout}
      onTagLayoutChange={(l) => { handleTagLayoutChange(l); setTagLayout(l) }}
      tagSortBy={tagSortBy}
      onTagSortChange={setTagSortBy}
      debouncedSearchKeyword={debouncedSearchKeyword}
      availableTags={tags}
      i18nNs="share"
      headerSlot={
        <ShareHeader
          shareInfo={shareInfo}
          totalCount={allBookmarks.length}
          filteredCount={sortedBookmarks.length}
          t={t}
        />
      }
      />
    </ExperimentalFeaturesProvider>
    </PublicShareSlugContext.Provider>
  )
}

/** 分享信息头部卡片 */
function ShareHeader({ shareInfo, totalCount, filteredCount, t }: {
  shareInfo?: { title?: string | null; description?: string | null; username?: string } | null
  totalCount: number
  filteredCount: number
  t: (key: string, opts?: Record<string, unknown>) => string
}) {
  if (!shareInfo && totalCount === 0) return null

  return (
    <div className="card shadow-float p-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex-1">
          <h1 className="text-xl sm:text-2xl font-bold text-primary">
            {shareInfo?.title || (shareInfo?.username ? t('defaultTitle', { username: shareInfo.username }) : t('guestTitle'))}
          </h1>
          {shareInfo?.description && <p className="text-sm text-muted-foreground mt-1">{shareInfo.description}</p>}
        </div>
        {totalCount > 0 && (
          <div className="text-sm text-muted-foreground">
            {filteredCount === totalCount
              ? t('stats.total', { count: totalCount })
              : t('stats.filtered', { filtered: filteredCount, total: totalCount })}
          </div>
        )}
      </div>
    </div>
  )
}
