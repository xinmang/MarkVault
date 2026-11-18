import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Bookmark } from '@/lib/types'
import { useRecordBookmarkClick } from '@/hooks/useClickTracking'
import { DefaultBookmarkIconComponent } from './DefaultBookmarkIcon'
import { BookmarkTagList } from './shared/BookmarkTagList'
import { getFaviconUrl, isGoogleDefaultIcon } from './bookmark-utils'
import { BookmarkUrlText } from './shared/BookmarkUrlText'
import { useExperimentalFeatures } from '@/contexts/ExperimentalFeaturesContext'
import { useBookmarkHoverCard } from './shared/BookmarkHoverCard'
import { useScreenshotLightbox } from './shared/useScreenshotLightbox'
import { BookmarkMediaButtons } from './shared/BookmarkMediaButtons'
import { ScreenshotLightbox } from './ScreenshotLightbox'
import { bookmarkLinkAttributes } from './TagLinkage'
import { BatchCheckbox } from './shared/BookmarkActions'
import { NotesPreview } from '@/components/notes/NotesButton'

export interface BookmarkListItemProps {
  bookmark: Bookmark
  onEdit?: () => void
  readOnly?: boolean
  batchMode?: boolean
  isSelected?: boolean
  onToggleSelect?: (id: string) => void
  showEditHint?: boolean
}

export const BookmarkListItem = memo(function BookmarkListItem({
  bookmark,
  onEdit,
  readOnly = false,
  batchMode = false,
  isSelected = false,
  onToggleSelect,
  showEditHint = false,
}: BookmarkListItemProps) {
  const { t } = useTranslation('bookmarks')
  const [coverImageError, setCoverImageError] = useState(false)
  const [faviconError, setFaviconError] = useState(false)
  const [googleFaviconIsDefault, setGoogleFaviconIsDefault] = useState(false)
  const recordClick = useRecordBookmarkClick(readOnly)
  const screenshotLightbox = useScreenshotLightbox()
  const { defaultBookmarkIcon: defaultIcon, urlPrivacy } = useExperimentalFeatures()
  const hoverCardProps = useBookmarkHoverCard(bookmark)
  const title = bookmark.title?.trim()
  const titleIsUrl = !title || title === bookmark.url || /^https?:\/\//i.test(title)

  const googleFaviconUrl = getFaviconUrl(bookmark.url)

  // 后端每次重新签发后封面/图标 URL 会变，旧的失败状态必须重置，否则图片会一直隐藏
  useEffect(() => {
    setCoverImageError(false)
  }, [bookmark.cover_image])

  useEffect(() => {
    setFaviconError(false)
    setGoogleFaviconIsDefault(false)
  }, [bookmark.favicon, bookmark.url])
  
  // 决定显示什么图片 - 四级回退策略
  // 1. cover_image (封面图)
  // 2. favicon (网站图标，从插件获取)
  // 3. Google Favicon API (但跳过默认灰色地球)
  // 4. 动画图标
  const hasCoverImage = bookmark.cover_image && !coverImageError
  const hasFavicon = !hasCoverImage && bookmark.favicon && !faviconError
  const shouldShowGoogleFavicon = !hasCoverImage && !hasFavicon && googleFaviconUrl && !faviconError && !googleFaviconIsDefault
  const shouldShowIcon = hasCoverImage || hasFavicon || shouldShowGoogleFavicon

  const handleVisit = () => {
    // 记录点击统计
    void recordClick(bookmark.id)
    // 打开书签
    window.open(bookmark.url, '_blank', 'noopener,noreferrer')
  }

  return (
    <>
    <div
      {...hoverCardProps}
      {...bookmarkLinkAttributes(bookmark, 'list')}
      className="bookmark-list-item card hover:shadow-lg transition-all relative group touch-manipulation"
      data-batch-selected={batchMode && isSelected ? 'true' : undefined}
    >
      {/* 批量选择复选框 */}
      {batchMode && onToggleSelect && (
        <BatchCheckbox bookmarkId={bookmark.id} isSelected={isSelected} onToggleSelect={onToggleSelect} />
      )}

      {/* 编辑按钮 - 初始显示10秒后隐藏 */}
      {!!onEdit && !readOnly && !batchMode && (
        <button
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onEdit()
          }}
          className={`absolute top-2 right-2 sm:top-3 sm:right-3 w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center transition-all hover:scale-110 z-10 touch-manipulation ${
            showEditHint ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 active:opacity-100'
          }`}
          title={t('action.edit')}
        >
          <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-base-content drop-shadow-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>
      )}

      <div className="flex flex-col gap-2">
        {/* 第一行：图标 + 标题/URL/状态标签 */}
        <div className="flex flex-row gap-3 sm:gap-4">
          {/* 封面图/图标 - 四级回退，始终显示 */}
          <div className="flex-shrink-0 w-16 h-16 sm:w-20 sm:h-20 rounded-lg overflow-hidden bg-gradient-to-br from-primary/5 to-secondary/5 flex items-center justify-center">
            {shouldShowIcon ? (
              hasCoverImage ? (
                <img
                  src={bookmark.cover_image!}
                  alt={bookmark.title}
                  className="w-full h-full object-cover"
                  onError={() => setCoverImageError(true)}
                />
              ) : hasFavicon ? (
                <img
                  src={bookmark.favicon!}
                  alt={bookmark.title}
                  className="w-8 h-8 sm:w-10 sm:h-10 object-contain"
                  onError={() => setFaviconError(true)}
                />
              ) : shouldShowGoogleFavicon ? (
                <img
                  src={googleFaviconUrl}
                  alt={bookmark.title}
                  className="w-8 h-8 sm:w-10 sm:h-10 object-contain"
                  onLoad={(e) => {
                    const img = e.target as HTMLImageElement
                    if (isGoogleDefaultIcon(img)) {
                      setGoogleFaviconIsDefault(true)
                    }
                  }}
                  onError={() => setFaviconError(true)}
                />
              ) : null
            ) : (
              <div className="w-10 h-10 sm:w-12 sm:h-12">
                <DefaultBookmarkIconComponent icon={defaultIcon} className="w-full h-full" />
              </div>
            )}
          </div>

          {/* 标题和URL区域 */}
          <div className="flex-1 min-w-0 flex flex-col justify-center">
            {/* 标题和状态标签 */}
            <div className="flex items-center gap-2 mb-1">
              <button
                onClick={handleVisit}
                className="font-semibold text-sm sm:text-base hover:text-primary transition-colors text-left flex-1 min-w-0 truncate"
                title={titleIsUrl && urlPrivacy.enabled ? undefined : bookmark.title}
              >
                {titleIsUrl ? <BookmarkUrlText value={title || bookmark.url} /> : title}
              </button>
              {bookmark.is_pinned && (
                <span className="bookmark-status-badge bookmark-status-badge--pinned text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0" title={t('status.pinned')}>
                  {t('status.pinned')}
                </span>
              )}
              {bookmark.is_archived && (
                <span className="bookmark-status-badge bookmark-status-badge--archived text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0" title={t('status.archived')}>
                  {t('status.archived')}
                </span>
              )}
            </div>

            {/* URL + 截图/快照入口 */}
            <div className="flex items-center gap-1.5 min-w-0">
              <a
                href={bookmark.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => { void recordClick(bookmark.id) }}
                onAuxClick={(event) => { if (event.button === 1) void recordClick(bookmark.id) }}
                className="text-xs text-primary hover:underline truncate min-w-0"
                title={urlPrivacy.enabled ? undefined : bookmark.url}
              >
                <BookmarkUrlText value={bookmark.url} />
              </a>
              <BookmarkMediaButtons
                bookmark={bookmark}
                onOpenScreenshot={() => screenshotLightbox.open(bookmark)}
                readOnly={readOnly}
                buttonClassName="w-5 h-5"
              />
            </div>
          </div>
        </div>

        {/* 第二行：描述（占据整个宽度） */}
        {bookmark.description && (
          <p className="text-sm text-base-content/70 line-clamp-2 leading-relaxed">
            {bookmark.description}
          </p>
        )}

        {/* 备注预览：只读页面的数据里没有备注 */}
        {!readOnly && (
          <NotesPreview
            target={{ kind: 'bookmark', id: bookmark.id, title: bookmark.title }}
            notes={bookmark.notes}
            count={bookmark.note_count}
          />
        )}

        {/* 第三行：标签和快照（占据整个宽度），与其他视图共用以支持标签联动 */}
        <BookmarkTagList bookmark={bookmark} maxTags={Number.MAX_SAFE_INTEGER} showSnapshot={false} />
      </div>
    </div>

    <ScreenshotLightbox
      bookmark={screenshotLightbox.bookmark}
      readOnly={readOnly}
      onClose={screenshotLightbox.close}
    />
    </>
  )
})
