import { useTranslation } from 'react-i18next'
import type { Bookmark } from '@/lib/types'
import { useRecordBookmarkClick } from '@/hooks/useClickTracking'
import { BookmarkUrlText } from './shared/BookmarkUrlText'
import { useExperimentalFeatures } from '@/contexts/ExperimentalFeaturesContext'
import { useBookmarkHoverCard } from './shared/BookmarkHoverCard'
import { useScreenshotLightbox } from './shared/useScreenshotLightbox'
import { BookmarkMediaButtons } from './shared/BookmarkMediaButtons'
import { ScreenshotLightbox } from './ScreenshotLightbox'
import { bookmarkLinkAttributes } from './TagLinkage'
import { motionIndexStyle } from '@/lib/motion'

interface BookmarkMinimalListViewProps {
  bookmarks: Bookmark[]
  onEdit?: (bookmark: Bookmark) => void
  readOnly?: boolean
  batchMode?: boolean
  selectedIds?: string[]
  onToggleSelect?: (id: string) => void
}

export function BookmarkMinimalListView({
  bookmarks,
  onEdit,
  readOnly = false,
  batchMode = false,
  selectedIds = [],
  onToggleSelect,
}: BookmarkMinimalListViewProps) {
  const { t } = useTranslation('bookmarks')
  
  return (
    <div className="bookmark-minimal-table rounded-xl border border-base-300 overflow-hidden overflow-x-auto">
      {/* 表头 - 移动端只显示标题和操作 */}
      <div className={`grid ${batchMode ? 'grid-cols-[auto_1fr_auto] sm:grid-cols-[auto_minmax(0,2fr)_minmax(0,2fr)_minmax(0,2fr)_auto]' : 'grid-cols-[1fr_auto] sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,2fr)_auto]'} gap-2 sm:gap-4 px-3 sm:px-4 py-2 text-xs uppercase tracking-wide text-base-content/50 bg-base-200 bookmark-minimal-head`}>
        {batchMode && <span></span>}
        <span>{t('view.header.title')}</span>
        <span className="hidden sm:block">{t('view.header.url')}</span>
        <span className="hidden sm:block">{t('view.header.note')}</span>
        <span className="text-right sm:block">{readOnly ? '' : ''}</span>
      </div>
      <div>
        {bookmarks.map((bookmark, index) => (
          <MinimalRow
            key={bookmark.id}
            motionIndex={index}
            bookmark={bookmark}
            onEdit={onEdit ? () => onEdit(bookmark) : undefined}
            readOnly={readOnly}
            batchMode={batchMode}
            isSelected={selectedIds.includes(bookmark.id)}
            onToggleSelect={onToggleSelect}
          />
        ))}
      </div>
    </div>
  )
}

interface MinimalRowProps {
  bookmark: Bookmark
  onEdit?: () => void
  readOnly?: boolean
  batchMode?: boolean
  isSelected?: boolean
  onToggleSelect?: (id: string) => void
  motionIndex?: number
}

function MinimalRow({
  bookmark,
  onEdit,
  readOnly = false,
  batchMode = false,
  isSelected = false,
  onToggleSelect,
  motionIndex = 0,
}: MinimalRowProps) {
  const { t } = useTranslation('bookmarks')
  const recordClick = useRecordBookmarkClick(readOnly)
  const screenshotLightbox = useScreenshotLightbox()
  const { urlPrivacy } = useExperimentalFeatures()
  const hoverCardProps = useBookmarkHoverCard(bookmark)
  const title = bookmark.title?.trim()
  const titleIsUrl = !title || title === bookmark.url || /^https?:\/\//i.test(title)

  const handleVisit = () => {
    void recordClick(bookmark.id)
    window.open(bookmark.url, '_blank', 'noopener,noreferrer')
  }

  return (
    <>
    <div {...hoverCardProps} {...bookmarkLinkAttributes(bookmark, 'minimal')} style={motionIndexStyle(motionIndex)} className={`grid ${batchMode ? 'grid-cols-[auto_1fr_auto] sm:grid-cols-[auto_minmax(0,2fr)_minmax(0,2fr)_minmax(0,2fr)_auto]' : 'grid-cols-[1fr_auto] sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,2fr)_auto]'} gap-2 sm:gap-4 px-3 sm:px-4 py-3 text-sm items-center border-t border-base-200 first:border-t-0 hover:bg-base-200/60 bookmark-minimal-row`}
      data-batch-selected={batchMode && isSelected ? 'true' : undefined}
    >
      {batchMode && onToggleSelect && (
        <div className="flex items-center justify-center">
          <button
            type="button"
            role="checkbox"
            aria-checked={isSelected}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onToggleSelect(bookmark.id)
            }}
            className="batch-checkbox w-5 h-5"
            title={isSelected ? t('batch.deselect') : t('batch.select')}
          >
            {isSelected && (
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>
        </div>
      )}
      
      {/* 标题 */}
      <button
        type="button"
        onClick={handleVisit}
        className="text-left font-medium text-sm sm:text-base truncate hover:text-primary min-w-0"
        title={titleIsUrl && urlPrivacy.enabled ? undefined : bookmark.title}
      >
        {titleIsUrl ? <BookmarkUrlText value={title || bookmark.url} /> : title}
      </button>
      
      {/* 网址 - 移动端隐藏 */}
      <a
        href={bookmark.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => { void recordClick(bookmark.id) }}
        onAuxClick={(event) => { if (event.button === 1) void recordClick(bookmark.id) }}
        className="hidden sm:block text-xs text-primary truncate hover:underline min-w-0"
        title={urlPrivacy.enabled ? undefined : bookmark.url}
      >
        <BookmarkUrlText value={bookmark.url} />
      </a>
      
      {/* 备注 - 移动端隐藏 */}
      <span className="hidden sm:block text-xs text-base-content/70 truncate min-w-0" title={bookmark.description || undefined}>
        {bookmark.description || t('view.noDescription')}
      </span>
      
      {/* 操作按钮 */}
      <div className="flex justify-end items-center gap-1">
        <BookmarkMediaButtons
          bookmark={bookmark}
          onOpenScreenshot={() => screenshotLightbox.open(bookmark)}
          buttonClassName="w-8 h-8"
          iconClassName="w-4 h-4"
        />
        {!!onEdit && !readOnly && !batchMode ? (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onEdit()
            }}
            className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-base-300 transition-colors text-base-content/70 hover:text-base-content"
            title={t('action.edit')}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
        ) : null}
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
