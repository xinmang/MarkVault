import type { Bookmark } from '@/lib/types'
import { SnapshotViewer } from '../SnapshotViewer'
import { hasBookmarkSnapshot } from '../bookmark-utils'
import { ScreenshotButton } from './ScreenshotButton'
import { NotesButton } from '@/components/notes/NotesButton'

interface BookmarkMediaButtonsProps {
  bookmark: Bookmark
  onOpenScreenshot: () => void
  /** 公开分享页等只读场景不显示备注入口 */
  readOnly?: boolean
  /** 单个按钮的尺寸 */
  buttonClassName?: string
  iconClassName?: string
  className?: string
}

/**
 * 截图 + 快照 + 备注图标按钮组，各视图统一按这个顺序紧挨着摆放。
 * 只读场景下没有截图和快照时不渲染任何东西。
 */
export function BookmarkMediaButtons({
  bookmark,
  onOpenScreenshot,
  readOnly = false,
  buttonClassName = 'w-6 h-6',
  iconClassName = 'w-3.5 h-3.5',
  className = '',
}: BookmarkMediaButtonsProps) {
  const hasScreenshot = !!bookmark.screenshot
  const hasSnapshot = hasBookmarkSnapshot(bookmark)
  if (!hasScreenshot && !hasSnapshot && readOnly) return null

  return (
    // 外层常处于 pointer-events-none 的卡片内容层里，这里重新开启点击
    <div
      className={`pointer-events-auto inline-flex flex-shrink-0 items-center gap-0.5 ${className}`}
      onClick={(event) => event.stopPropagation()}
    >
      {hasScreenshot && (
        <ScreenshotButton onClick={onOpenScreenshot} className={buttonClassName} iconClassName={iconClassName} />
      )}
      {hasSnapshot && (
        <SnapshotViewer
          bookmarkId={bookmark.id}
          bookmarkTitle={bookmark.title}
          bookmarkUrl={bookmark.url}
          snapshotCount={bookmark.snapshot_count ?? 0}
          variant="icon"
          className={buttonClassName}
          iconClassName={iconClassName}
        />
      )}
      {!readOnly && (
        <NotesButton
          target={{ kind: 'bookmark', id: bookmark.id, title: bookmark.title }}
          count={bookmark.note_count ?? 0}
          className={buttonClassName}
          iconClassName={iconClassName}
        />
      )}
    </div>
  )
}
