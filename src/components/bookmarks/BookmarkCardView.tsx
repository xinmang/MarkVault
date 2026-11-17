import { useTranslation } from 'react-i18next'
import type { Bookmark } from '@/lib/types'
import { AdaptiveImage } from '@/components/common/AdaptiveImage'
import { useRecordBookmarkClick } from '@/hooks/useClickTracking'
import { useEffect, useState } from 'react'
import { GalleryVerticalEnd, Maximize2 } from 'lucide-react'
import type { ImageType } from '@/lib/image-utils'
import { DefaultBookmarkIconComponent } from './DefaultBookmarkIcon'
import { MasonryGrid } from './shared/MasonryGrid'
import { BatchCheckbox, EditButton } from './shared/BookmarkActions'
import { BookmarkTagList } from './shared/BookmarkTagList'
import { useFaviconFallback } from './shared/useFaviconFallback'
import { BookmarkUrlText } from './shared/BookmarkUrlText'
import { useBookmarkHoverCard } from './shared/BookmarkHoverCard'
import { useScreenshotLightbox } from './shared/useScreenshotLightbox'
import { ScreenshotLightbox } from './ScreenshotLightbox'
import { SnapshotViewer } from './SnapshotViewer'
import { hasBookmarkSnapshot } from './bookmark-utils'
import { useExperimentalFeatures } from '@/contexts/ExperimentalFeaturesContext'
import { bookmarkLinkAttributes } from './TagLinkage'

interface BookmarkCardViewProps {
  bookmarks: Bookmark[]
  onEdit?: (bookmark: Bookmark) => void
  readOnly?: boolean
  batchMode?: boolean
  selectedIds?: string[]
  onToggleSelect?: (id: string) => void
}

export function BookmarkCardView({
  bookmarks, onEdit, readOnly = false,
  batchMode = false, selectedIds = [], onToggleSelect,
}: BookmarkCardViewProps) {
  return (
    <MasonryGrid
      bookmarks={bookmarks}
      minColumnWidth={280}
      gap={16}
      renderItem={(bookmark, showEditHint) => (
        <BookmarkCard
          bookmark={bookmark}
          onEdit={onEdit ? () => onEdit(bookmark) : undefined}
          readOnly={readOnly}
          batchMode={batchMode}
          isSelected={selectedIds.includes(bookmark.id)}
          onToggleSelect={onToggleSelect}
          showEditHint={showEditHint}
        />
      )}
    />
  )
}

interface BookmarkCardProps {
  bookmark: Bookmark
  onEdit?: () => void
  readOnly?: boolean
  batchMode?: boolean
  isSelected?: boolean
  onToggleSelect?: (id: string) => void
  showEditHint?: boolean
}

function BookmarkCard({
  bookmark, onEdit, readOnly = false,
  batchMode = false, isSelected = false, onToggleSelect, showEditHint = false,
}: BookmarkCardProps) {
  const { t } = useTranslation('bookmarks')
  const [imageType, setImageType] = useState<ImageType>('unknown')
  const [screenshotError, setScreenshotError] = useState(false)
  const screenshotLightbox = useScreenshotLightbox()
  const recordClick = useRecordBookmarkClick(readOnly)
  const { defaultBookmarkIcon: defaultIcon } = useExperimentalFeatures()
  const hoverCardProps = useBookmarkHoverCard(bookmark)
  const {
    googleFaviconUrl, hasCoverImage, hasFavicon, hasGoogleFavicon, hasAnyIcon,
    setCoverImageError, setFaviconError, checkIfGoogleDefaultIcon,
  } = useFaviconFallback(bookmark)

  const handleVisit = () => {
    void recordClick(bookmark.id)
    window.open(bookmark.url, '_blank', 'noopener,noreferrer')
  }

  const handleCardClick = (e: React.MouseEvent) => {
    if (batchMode && onToggleSelect) { e.preventDefault(); onToggleSelect(bookmark.id) }
    else handleVisit()
  }

  const screenshot = bookmark.screenshot

  // 后端重新签发后 URL 会变，旧的加载失败状态必须重置
  useEffect(() => {
    setScreenshotError(false)
  }, [screenshot?.url])

  // 截图区域：批量模式下保持选中行为，其余情况只打开灯箱
  const handleScreenshotActivate = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (batchMode && onToggleSelect) onToggleSelect(bookmark.id)
    else screenshotLightbox.open(bookmark)
  }

  const showScreenshotCover = !!screenshot && !screenshotError
  // 快照胶囊固定在封面左下角：有截图时排在截图胶囊后面，没有截图时单独显示，不挤进标签行
  const snapshotChip = hasBookmarkSnapshot(bookmark) ? (
    <SnapshotViewer
      bookmarkId={bookmark.id}
      bookmarkTitle={bookmark.title}
      bookmarkUrl={bookmark.url}
      snapshotCount={bookmark.snapshot_count ?? 0}
    />
  ) : null
  const coverSnapshotChip = snapshotChip && (
    <div className="absolute bottom-2 left-2 flex items-center" onClick={(e) => e.stopPropagation()}>
      {snapshotChip}
    </div>
  )

  const radiusStyle = { borderTopLeftRadius: 'calc(var(--radius) * 1.5)', borderTopRightRadius: 'calc(var(--radius) * 1.5)' }
  const title = bookmark.title?.trim()
  const titleIsUrl = !title || title === bookmark.url || /^https?:\/\//i.test(title)

  return (
    <>
    <div
      {...hoverCardProps}
      {...bookmarkLinkAttributes(bookmark, 'card')}
      className="bookmark-card card hover:shadow-xl transition-all relative group flex flex-col cursor-pointer focus:outline-none touch-manipulation w-full min-w-0"
      data-batch-selected={batchMode && isSelected ? 'true' : undefined}
      role="link" tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (batchMode && onToggleSelect) { onToggleSelect(bookmark.id) } else { handleVisit() } } }}
      aria-label={t('action.open', { title: bookmark.title })}
    >
      {batchMode && onToggleSelect && (
        <BatchCheckbox bookmarkId={bookmark.id} isSelected={isSelected} onToggleSelect={onToggleSelect} />
      )}
      {!!onEdit && !readOnly && !batchMode && <EditButton onEdit={onEdit} showHint={showEditHint} />}

      {/* 图片区域 */}
      {showScreenshotCover ? (
        <div
          className="relative overflow-hidden flex-shrink-0 cursor-pointer"
          style={radiusStyle}
          onClick={handleScreenshotActivate}
        >
          <img
            src={screenshot.url}
            alt={t('screenshot.imageAlt', { title: bookmark.title })}
            loading="lazy"
            decoding="async"
            className="block w-full aspect-[16/10] object-cover object-top"
            onError={() => setScreenshotError(true)}
          />
          {/* 底部渐变，让截图自然过渡到内容区 */}
          <div
            className="absolute inset-x-0 bottom-0 h-10 pointer-events-none"
            style={{ background: 'linear-gradient(to top, var(--card), transparent)' }}
          />
          <div className="absolute bottom-2 left-2 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={handleScreenshotActivate}
            onKeyDown={(e) => e.stopPropagation()}
            className="bookmark-media-chip inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium shadow-sm hover:scale-105 active:scale-95 transition-transform"
            title={t('screenshot.view')}
          >
            <GalleryVerticalEnd className="w-3 h-3" strokeWidth={2} />
            {t('screenshot.chip')}
            <Maximize2 className="w-3 h-3 opacity-70" strokeWidth={2} />
          </button>
          {snapshotChip}
          </div>
        </div>
      ) : hasAnyIcon ? (
        <div
          className={`relative overflow-hidden flex-shrink-0 flex items-center justify-center ${
            imageType === 'favicon' || hasFavicon || hasGoogleFavicon
              ? 'h-24 sm:h-20 bg-gradient-to-br from-primary/5 to-secondary/5'
              : 'h-40 sm:h-32 bg-gradient-to-br from-primary/10 to-secondary/10'
          }`}
          style={radiusStyle}
        >
          {hasCoverImage ? (
            <AdaptiveImage
              src={bookmark.cover_image!} alt={bookmark.title}
              className={imageType === 'favicon' ? 'w-14 h-14 sm:w-12 sm:h-12 object-contain' : 'w-full h-full object-cover'}
              onTypeDetected={setImageType} onError={() => setCoverImageError(true)}
            />
          ) : hasFavicon ? (
            <div className="relative w-14 h-14 sm:w-12 sm:h-12 flex items-center justify-center">
              <img src={bookmark.favicon!} alt={bookmark.title} className="w-full h-full object-contain" onError={() => setFaviconError(true)} />
            </div>
          ) : hasGoogleFavicon ? (
            <div className="relative w-14 h-14 sm:w-12 sm:h-12 flex items-center justify-center">
              <img src={googleFaviconUrl} alt={bookmark.title} className="w-full h-full object-contain"
                onLoad={(e) => checkIfGoogleDefaultIcon(e.target as HTMLImageElement)} onError={() => setFaviconError(true)} />
            </div>
          ) : null}
          {coverSnapshotChip}
        </div>
      ) : (
        <div className="relative h-24 sm:h-20 overflow-hidden flex-shrink-0 flex items-center justify-center bg-gradient-to-br from-primary/5 via-secondary/5 to-accent/5" style={radiusStyle}>
          <DefaultBookmarkIconComponent icon={defaultIcon} />
          {coverSnapshotChip}
        </div>
      )}

      {/* 内容区 */}
      <div className="flex flex-col p-4 sm:p-3 gap-2.5 sm:gap-2 relative">
        {(bookmark.is_pinned || bookmark.is_archived) && (
          <div className="flex gap-1.5 mb-1">
            {bookmark.is_pinned && <span className="bookmark-status-badge bookmark-status-badge--pinned text-xs px-2 py-0.5 rounded-full font-medium">{t('status.pinned')}</span>}
            {bookmark.is_archived && <span className="bookmark-status-badge bookmark-status-badge--archived text-xs px-2 py-0.5 rounded-full font-medium">{t('status.archived')}</span>}
          </div>
        )}

        <h3 className="font-semibold text-base sm:text-sm line-clamp-2 hover:text-primary transition-colors leading-snug" title={bookmark.title}>
          {titleIsUrl ? <BookmarkUrlText value={title || bookmark.url} /> : title}
        </h3>

        {bookmark.description && (
          <p className="text-sm sm:text-xs text-base-content/70 line-clamp-3 leading-relaxed">{bookmark.description}</p>
        )}

        {bookmark.ai_summary && (
          <div className="bg-primary/5 border border-primary/10 rounded-lg p-2.5 sm:p-2 mt-0.5">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-[10px] font-bold text-primary uppercase tracking-wider bg-primary/10 px-1.5 py-0.5 rounded">AI</span>
              <span className="text-[11px] font-medium text-primary/80">{t('view.aiSummaryTitle')}</span>
            </div>
            <p className="text-[11px] text-base-content/80 line-clamp-3 italic leading-relaxed">"{bookmark.ai_summary}"</p>
          </div>
        )}

        <div className="mt-1">
          <BookmarkTagList bookmark={bookmark} showSnapshot={false} />
        </div>
      </div>
    </div>

    <ScreenshotLightbox
      bookmark={screenshotLightbox.bookmark}
      readOnly={readOnly}
      onClose={screenshotLightbox.close}
    />
    </>
  )
}
