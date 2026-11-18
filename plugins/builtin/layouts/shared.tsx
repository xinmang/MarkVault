/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil, Pin } from 'lucide-react'
import type { Bookmark } from '@/lib/types'
import type { PluginViewMode } from '@/lib/constants/bookmarks'
import { useRecordBookmarkClick } from '@/hooks/useClickTracking'
import { useExperimentalFeatures } from '@/contexts/ExperimentalFeaturesContext'
import { DefaultBookmarkIconComponent } from '@/components/bookmarks/DefaultBookmarkIcon'
import { bookmarkLinkAttributes } from '@/components/bookmarks/TagLinkage'
import { BookmarkTagList } from '@/components/bookmarks/shared/BookmarkTagList'
import { BookmarkUrlText } from '@/components/bookmarks/shared/BookmarkUrlText'
import { useBookmarkHoverCard } from '@/components/bookmarks/shared/BookmarkHoverCard'
import { useFaviconFallback } from '@/components/bookmarks/shared/useFaviconFallback'
import { NotesButton } from '@/components/notes/NotesButton'
import { motionIndexStyle } from '@/lib/motion'
import { bookmarkHost } from './grouping'
import './style.css'

export { bookmarkHost }

/** 布局插件提供的书签视图与核心视图使用同一组属性。 */
export interface BookmarkLayoutViewProps {
  bookmarks: Bookmark[]
  onEdit?: (bookmark: Bookmark) => void
  readOnly?: boolean
  batchMode?: boolean
  selectedIds?: string[]
  onToggleSelect?: (id: string) => void
}

export type BookmarkEntryProps = Omit<BookmarkLayoutViewProps, 'bookmarks' | 'selectedIds'> & {
  bookmark: Bookmark
  isSelected: boolean
}

/** 打开或（批量模式下）勾选书签，并给出可直接渲染的标题。 */
export function useBookmarkEntry({
  bookmark,
  readOnly = false,
  batchMode = false,
  onToggleSelect,
}: BookmarkEntryProps) {
  const recordClick = useRecordBookmarkClick(readOnly)
  const { urlPrivacy } = useExperimentalFeatures()
  const title = bookmark.title?.trim()
  const titleIsUrl = !title || title === bookmark.url || /^https?:\/\//i.test(title)
  const activate = () => {
    if (batchMode && onToggleSelect) {
      onToggleSelect(bookmark.id)
      return
    }
    void recordClick(bookmark.id)
    window.open(bookmark.url, '_blank', 'noopener,noreferrer')
  }
  return {
    activate,
    title: titleIsUrl ? <BookmarkUrlText value={title || bookmark.url} /> : (title as ReactNode),
    tooltip: urlPrivacy.enabled ? undefined : title || bookmark.url,
  }
}

export function BookmarkFavicon({ bookmark, className = '' }: { bookmark: Bookmark; className?: string }) {
  const { defaultBookmarkIcon } = useExperimentalFeatures()
  const icon = useFaviconFallback(bookmark)
  return (
    <span className={`layout-favicon ${className}`} aria-hidden="true">
      {icon.hasCoverImage ? (
        <img src={bookmark.cover_image!} alt="" onError={() => icon.setCoverImageError(true)} />
      ) : icon.hasFavicon ? (
        <img src={bookmark.favicon!} alt="" onError={() => icon.setFaviconError(true)} />
      ) : icon.hasGoogleFavicon ? (
        <img
          src={icon.googleFaviconUrl}
          alt=""
          onLoad={(event) => icon.checkIfGoogleDefaultIcon(event.currentTarget)}
          onError={() => icon.setFaviconError(true)}
        />
      ) : (
        <DefaultBookmarkIconComponent icon={defaultBookmarkIcon} className="w-full h-full" />
      )}
    </span>
  )
}

export function InlineBatchCheckbox({ bookmark, isSelected, batchMode, onToggleSelect }: BookmarkEntryProps) {
  const { t } = useTranslation('bookmarks')
  if (!batchMode || !onToggleSelect) return null
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={isSelected}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onToggleSelect(bookmark.id)
      }}
      className="batch-checkbox w-5 h-5 flex-shrink-0"
      title={isSelected ? t('batch.deselect') : t('batch.select')}
    >
      {isSelected && (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      )}
    </button>
  )
}

export function InlineNotesButton({ bookmark, readOnly, batchMode }: BookmarkEntryProps) {
  if (readOnly || batchMode) return null
  return (
    <NotesButton
      target={{ kind: 'bookmark', id: bookmark.id, title: bookmark.title }}
      count={bookmark.note_count}
      className="w-7 h-7 bookmark-screenshot-button--floating"
    />
  )
}

export function InlineEditButton({ bookmark, onEdit, readOnly, batchMode }: BookmarkEntryProps) {
  const { t } = useTranslation('bookmarks')
  if (!onEdit || readOnly || batchMode) return null
  return (
    <button
      type="button"
      className="layout-edit"
      title={t('action.edit')}
      aria-label={t('action.edit')}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onEdit(bookmark)
      }}
    >
      <Pencil size={14} aria-hidden="true" />
    </button>
  )
}

type BookmarkRowProps = BookmarkEntryProps & {
  view: PluginViewMode
  index?: number
  /** 行尾的补充信息，例如收藏时间 */
  meta?: ReactNode
  showHost?: boolean
}

/** 时间线与站点分组共用的紧凑行：图标、标题、站点、标签和行内操作。 */
export function BookmarkRow({ view, index = 0, meta, showHost = true, ...entryProps }: BookmarkRowProps) {
  const { bookmark, isSelected, batchMode } = entryProps
  const { t } = useTranslation('bookmarks')
  const entry = useBookmarkEntry(entryProps)
  const hoverCardProps = useBookmarkHoverCard(bookmark)
  return (
    <div
      {...hoverCardProps}
      {...bookmarkLinkAttributes(bookmark, view)}
      style={motionIndexStyle(index)}
      className="layout-row"
      data-batch-selected={batchMode && isSelected ? 'true' : undefined}
    >
      <InlineBatchCheckbox {...entryProps} />
      <button type="button" className="layout-row__open" onClick={entry.activate} title={entry.tooltip}>
        <BookmarkFavicon bookmark={bookmark} />
        <span className="layout-row__title">{entry.title}</span>
        {bookmark.is_pinned && (
          <Pin className="layout-row__pin" size={12} aria-label={t('status.pinned')} />
        )}
        {showHost && (
          <span className="layout-row__host">
            <BookmarkUrlText value={bookmarkHost(bookmark.url)} />
          </span>
        )}
      </button>
      {bookmark.tags?.length > 0 && (
        <div className="layout-row__tags">
          <BookmarkTagList bookmark={bookmark} maxTags={2} showSnapshot={false} />
        </div>
      )}
      {meta && <span className="layout-row__meta">{meta}</span>}
      <InlineNotesButton {...entryProps} />
      <InlineEditButton {...entryProps} />
    </div>
  )
}
