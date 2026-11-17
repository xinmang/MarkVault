/**
 * 书签标签 + 快照按钮展示（共享）
 */

import { useTranslation } from 'react-i18next'
import type { Bookmark } from '@/lib/types'
import { SnapshotViewer } from '../SnapshotViewer'
import { useTagLinkage } from '../TagLinkage'
import { hasBookmarkSnapshot } from '../bookmark-utils'

interface BookmarkTagListProps {
  bookmark: Bookmark
  maxTags?: number
  /** 快照入口已和截图按钮放在一起时传 false，避免重复 */
  showSnapshot?: boolean
}

const CHIP_CLASS =
  'bookmark-tag-chip text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium'

export function BookmarkTagList({ bookmark, maxTags = 5, showSnapshot = true }: BookmarkTagListProps) {
  const { t } = useTranslation('tags')
  const linkage = useTagLinkage()
  const hasTags = bookmark.tags && bookmark.tags.length > 0
  const hasSnapshot = showSnapshot && hasBookmarkSnapshot(bookmark)

  if (!hasTags && !hasSnapshot) return null

  // 只多出一个时直接显示，"+1" 占的位置和一个标签差不多
  const tags = bookmark.tags ?? []
  const visibleCount = tags.length <= maxTags + 1 ? tags.length : maxTags
  const hiddenCount = tags.length - visibleCount

  return (
    <div className="flex flex-wrap items-center gap-1 sm:gap-1.5">
      {tags.slice(0, visibleCount).map((tag) => {
        const selected = linkage?.selectedTagIds.has(tag.id) ?? false
        const onToggleTag = linkage?.onToggleTag
        // 联动开启时芯片可直接切换筛选；阻止冒泡，避免同时打开书签
        return onToggleTag ? (
          <button
            key={tag.id}
            type="button"
            data-link-tag={tag.id}
            aria-pressed={selected}
            className={`${CHIP_CLASS} bookmark-tag-chip--interactive pointer-events-auto`}
            title={t(selected ? 'linkage.removeFilter' : 'linkage.filterByTag', { name: tag.name })}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onToggleTag(tag.id)
            }}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {tag.name}
          </button>
        ) : (
          <span key={tag.id} data-link-tag={tag.id} className={CHIP_CLASS}>
            {tag.name}
          </span>
        )
      })}
      {hiddenCount > 0 && (
        <span className="text-[10px] sm:text-xs text-muted-foreground/60">
          +{hiddenCount}
        </span>
      )}
      {hasSnapshot && (
        <div className="pointer-events-auto" onClick={(e) => e.stopPropagation()}>
          <SnapshotViewer
            bookmarkId={bookmark.id}
            bookmarkTitle={bookmark.title}
            bookmarkUrl={bookmark.url}
            snapshotCount={bookmark.snapshot_count ?? 0}
          />
        </div>
      )}
    </div>
  )
}
