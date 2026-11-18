import { useState } from 'react'
import type { Bookmark } from '@/lib/types'
import { bookmarkLinkAttributes } from '@/components/bookmarks/TagLinkage'
import { BookmarkTagList } from '@/components/bookmarks/shared/BookmarkTagList'
import { BookmarkUrlText } from '@/components/bookmarks/shared/BookmarkUrlText'
import { useBookmarkHoverCard } from '@/components/bookmarks/shared/BookmarkHoverCard'
import { motionIndexStyle } from '@/lib/motion'
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

/** 画廊视图：封面或网站截图铺满磁贴，悬停时浮出描述与标签。 */
export function BookmarkGalleryView({ bookmarks, selectedIds = [], ...rest }: BookmarkLayoutViewProps) {
  return (
    <div className="layout-gallery">
      {bookmarks.map((bookmark, index) => (
        <GalleryTile
          key={bookmark.id}
          bookmark={bookmark}
          isSelected={selectedIds.includes(bookmark.id)}
          index={index}
          {...rest}
        />
      ))}
    </div>
  )
}

function tileImage(bookmark: Bookmark): string | undefined {
  return bookmark.cover_image?.trim() || bookmark.screenshot?.url || undefined
}

function GalleryTile(props: BookmarkEntryProps & { index: number }) {
  const { bookmark, isSelected, batchMode, index } = props
  const entry = useBookmarkEntry(props)
  const hoverCardProps = useBookmarkHoverCard(bookmark)
  const image = tileImage(bookmark)
  const [failed, setFailed] = useState<string>()
  const showImage = !!image && failed !== image
  const host = bookmarkHost(bookmark.url)

  return (
    <article
      {...hoverCardProps}
      {...bookmarkLinkAttributes(bookmark, 'gallery')}
      style={motionIndexStyle(index)}
      className="layout-gallery__tile"
      data-batch-selected={batchMode && isSelected ? 'true' : undefined}
    >
      <button type="button" className="layout-gallery__open" onClick={entry.activate} title={entry.tooltip}>
        <span className="layout-gallery__media" data-empty={showImage ? undefined : 'true'}>
          {showImage ? (
            <img src={image} alt="" loading="lazy" onError={() => setFailed(image)} />
          ) : (
            <>
              <BookmarkFavicon bookmark={bookmark} className="layout-gallery__placeholder-icon" />
              <span className="layout-gallery__initial" aria-hidden="true">
                {host.charAt(0).toUpperCase()}
              </span>
            </>
          )}
        </span>
        <span className="layout-gallery__caption">
          <span className="layout-gallery__title">{entry.title}</span>
          <span className="layout-gallery__host">
            <BookmarkFavicon bookmark={bookmark} />
            <BookmarkUrlText value={host} />
          </span>
        </span>
      </button>
      {(bookmark.description || bookmark.tags?.length > 0) && (
        <div className="layout-gallery__details">
          {bookmark.description && <p>{bookmark.description}</p>}
          <BookmarkTagList bookmark={bookmark} maxTags={3} showSnapshot={false} />
        </div>
      )}
      <div className="layout-gallery__corner">
        <InlineBatchCheckbox {...props} />
        <InlineNotesButton {...props} />
        <InlineEditButton {...props} />
      </div>
    </article>
  )
}
