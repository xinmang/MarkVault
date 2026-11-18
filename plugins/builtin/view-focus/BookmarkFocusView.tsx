import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import type { Bookmark } from '@/lib/types'
import { bookmarkLinkAttributes } from '@/components/bookmarks/TagLinkage'
import { BookmarkTagList } from '@/components/bookmarks/shared/BookmarkTagList'
import { BookmarkUrlText } from '@/components/bookmarks/shared/BookmarkUrlText'
import {
  BookmarkFavicon,
  InlineBatchCheckbox,
  InlineEditButton,
  InlineNotesButton,
  bookmarkHost,
  useBookmarkEntry,
  type BookmarkEntryProps,
  type BookmarkLayoutViewProps,
} from '../layouts/shared'

/** 专注视图：一次只看一条书签，用方向键或下方的条目逐条浏览。 */
export function BookmarkFocusView({ bookmarks, selectedIds = [], ...rest }: BookmarkLayoutViewProps) {
  const { t } = useTranslation('plugins')
  const [currentId, setCurrentId] = useState<string>()
  const stripRef = useRef<HTMLDivElement>(null)
  // 筛选或排序变化后当前书签可能已不在列表中，此时回到第一条
  const index = Math.max(
    0,
    bookmarks.findIndex((bookmark) => bookmark.id === currentId)
  )
  const current = bookmarks[index]

  useEffect(() => {
    stripRef.current
      ?.querySelector('[aria-current="true"]')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [current?.id])

  if (!current) return null
  const go = (next: number) => {
    const target = bookmarks[Math.min(bookmarks.length - 1, Math.max(0, next))]
    if (target) setCurrentId(target.id)
  }
  const onKeyDown = (event: KeyboardEvent) => {
    // 只占用左右方向键，上下键与 Home/End 留给页面滚动
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    go(event.key === 'ArrowRight' ? index + 1 : index - 1)
  }

  return (
    <div className="layout-focus" onKeyDown={onKeyDown}>
      <div className="layout-focus__stage">
        <button
          type="button"
          className="layout-focus__nav"
          onClick={() => go(index - 1)}
          disabled={index === 0}
          title={t('layouts.focus.previous')}
          aria-label={t('layouts.focus.previous')}
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <FocusCard
          key={current.id}
          bookmark={current}
          isSelected={selectedIds.includes(current.id)}
          {...rest}
        />
        <button
          type="button"
          className="layout-focus__nav"
          onClick={() => go(index + 1)}
          disabled={index === bookmarks.length - 1}
          title={t('layouts.focus.next')}
          aria-label={t('layouts.focus.next')}
        >
          <ChevronRight size={20} aria-hidden="true" />
        </button>
      </div>
      <p className="layout-focus__position" aria-live="polite">
        {t('layouts.focus.position', { current: index + 1, total: bookmarks.length })}
      </p>
      <div ref={stripRef} className="layout-focus__strip">
        {bookmarks.map((bookmark) => (
          <StripItem
            key={bookmark.id}
            bookmark={bookmark}
            current={bookmark.id === current.id}
            selected={!!rest.batchMode && selectedIds.includes(bookmark.id)}
            onPick={() => setCurrentId(bookmark.id)}
          />
        ))}
      </div>
    </div>
  )
}

function FocusCard(props: BookmarkEntryProps) {
  const { bookmark, isSelected, batchMode } = props
  const { t } = useTranslation('plugins')
  const entry = useBookmarkEntry(props)
  const image = bookmark.cover_image?.trim() || bookmark.screenshot?.url || undefined
  const [failed, setFailed] = useState(false)
  const summary = bookmark.description?.trim() || bookmark.ai_summary?.trim()

  return (
    <article
      {...bookmarkLinkAttributes(bookmark, 'focus')}
      className="layout-focus__card"
      data-batch-selected={batchMode && isSelected ? 'true' : undefined}
    >
      {image && !failed && (
        <div className="layout-focus__media">
          <img src={image} alt="" onError={() => setFailed(true)} />
        </div>
      )}
      <div className="layout-focus__body">
        <div className="layout-focus__host">
          <InlineBatchCheckbox {...props} />
          <BookmarkFavicon bookmark={bookmark} />
          <BookmarkUrlText value={bookmarkHost(bookmark.url)} />
          <InlineNotesButton {...props} />
          <InlineEditButton {...props} />
        </div>
        <h3 className="layout-focus__title" title={entry.tooltip}>
          {entry.title}
        </h3>
        {summary && <p className="layout-focus__summary">{summary}</p>}
        <BookmarkTagList bookmark={bookmark} maxTags={8} showSnapshot={false} />
        <button type="button" className="btn btn-primary layout-focus__open" onClick={entry.activate}>
          {!batchMode && <ExternalLink size={16} aria-hidden="true" />}
          {batchMode
            ? t(isSelected ? 'layouts.focus.deselect' : 'layouts.focus.select')
            : t('layouts.focus.open')}
        </button>
      </div>
    </article>
  )
}

function StripItem({
  bookmark,
  current,
  selected,
  onPick,
}: {
  bookmark: Bookmark
  current: boolean
  selected: boolean
  onPick: () => void
}) {
  const title = bookmark.title?.trim()
  const titleIsUrl = !title || title === bookmark.url || /^https?:\/\//i.test(title)
  return (
    <button
      type="button"
      className="layout-focus__chip"
      aria-current={current ? 'true' : undefined}
      data-batch-selected={selected ? 'true' : undefined}
      onClick={onPick}
    >
      <BookmarkFavicon bookmark={bookmark} />
      <span>{titleIsUrl ? <BookmarkUrlText value={title || bookmark.url} /> : title}</span>
    </button>
  )
}
