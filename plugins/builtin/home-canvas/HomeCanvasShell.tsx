import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pin } from 'lucide-react'
import type { Bookmark } from '@/lib/types'
import { BookmarkUrlText } from '@/components/bookmarks/shared/BookmarkUrlText'
import { InfiniteCanvas, type CanvasItem } from '../canvas/InfiniteCanvas'
import { TagButton } from '../layouts/TagButton'
import {
  BookmarkFavicon,
  InlineBatchCheckbox,
  InlineEditButton,
  bookmarkHost,
  useBookmarkEntry,
} from '../layouts/shared'
import { tagColumns } from '../shells/grouping'
import {
  HomeShellRoot,
  ShellAllTagsButton,
  ShellClearTagsButton,
  ShellListState,
  ShellLoadMore,
  ShellTagChip,
  ShellTagPanel,
  ShellToolbar,
  shellEntryProps,
  useShellTags,
  type HomeShellProps,
} from '../shells/home-shared'

/** 卡片高度在测量之前的估计值，只影响首帧排布。 */
const HEADER_HEIGHT = 46
const ROW_HEIGHT = 46
const CHIP_ROW_HEIGHT = 38
const CHIPS_PER_ROW = 5
const TAGS_CARD_ID = 'tags'

/**
 * 无限画布版式：全部标签是一张卡片，每个标签下的书签各是一张卡片，
 * 一起铺在可以平移和缩放的画布上。内容再多也不受屏幕大小限制，
 * 缩小看全貌，放大看细节，卡片可以拖到自己习惯的位置。
 */
export function HomeCanvasShell(shell: HomeShellProps) {
  const { t } = useTranslation('plugins')
  const tags = useShellTags(shell)
  const [panelOpen, setPanelOpen] = useState(false)
  // 画布没有宽度限制，出现在书签里的标签全部成卡片
  const columns = useMemo(
    () => tagColumns(shell.bookmarks, tags.tags, Number.POSITIVE_INFINITY),
    [shell.bookmarks, tags.tags]
  )

  const items: CanvasItem[] = [
    {
      id: TAGS_CARD_ID,
      label: t('shells.allTags'),
      span: 2,
      estimatedHeight:
        HEADER_HEIGHT +
        24 +
        Math.max(1, Math.ceil(tags.tags.length / CHIPS_PER_ROW)) * CHIP_ROW_HEIGHT,
      content: (
        <section className="pcanvas-card">
          <header className="pcanvas-card__header">
            <span className="pcanvas-card__title">{t('shells.allTags')}</span>
            <span className="pshell-count">{tags.tags.length}</span>
          </header>
          {tags.tags.length > 0 ? (
            <div className="pcanvas-card__chips">
              {tags.tags.map((tag) => (
                <ShellTagChip key={tag.id} tag={tag} chip={tags.chip} />
              ))}
            </div>
          ) : (
            // 标签还在加载时先留空，加载完确实没有标签才提示
            !tags.isLoading && <p className="pcanvas-card__empty">{t('shells.noTags')}</p>
          )}
        </section>
      ),
    },
    ...columns.map((column) => ({
      id: column.tag ? 'tag:' + column.tag.id : 'untagged',
      label: column.tag?.name ?? t('shells.untagged'),
      estimatedHeight: HEADER_HEIGHT + 12 + column.items.length * ROW_HEIGHT,
      content: (
        <section className="pcanvas-card">
          <header className="pcanvas-card__header">
            {column.tag ? (
              <TagButton tag={column.tag} className="pcanvas-card__tag" {...tags.chip}>
                <span className="pcanvas-card__title">{column.tag.name}</span>
              </TagButton>
            ) : (
              <span className="pcanvas-card__title">{t('shells.untagged')}</span>
            )}
            <span className="pshell-count">{column.items.length}</span>
          </header>
          <div className="pcanvas-card__items">
            {column.items.map((bookmark) => (
              <CanvasBookmarkRow key={bookmark.id} shell={shell} bookmark={bookmark} />
            ))}
          </div>
        </section>
      ),
    })),
  ]

  return (
    <HomeShellRoot name="canvas" shell={shell}>
      <div className="pcanvas-home__bar">
        {shell.headerSlot}
        <ShellToolbar shell={shell} />
        <div className="pcanvas-home__status">
          <ShellAllTagsButton onClick={() => setPanelOpen(true)} />
          <ShellClearTagsButton shell={shell} />
          <ShellLoadMore shell={shell} />
        </div>
      </div>
      {shell.selectionPromptSlot}
      {shell.isError || shell.bookmarks.length === 0 ? (
        <div className="pshell-scroll">
          <ShellListState shell={shell} />
        </div>
      ) : (
        <InfiniteCanvas storageKey="home" items={items} columnWidth={304} />
      )}
      <ShellTagPanel shell={shell} isOpen={panelOpen} onClose={() => setPanelOpen(false)} />
    </HomeShellRoot>
  )
}

function CanvasBookmarkRow({ shell, bookmark }: { shell: HomeShellProps; bookmark: Bookmark }) {
  const { t } = useTranslation('bookmarks')
  const entryProps = shellEntryProps(shell, bookmark)
  const entry = useBookmarkEntry(entryProps)
  return (
    <div
      className="pcanvas-row"
      data-batch-selected={shell.batchMode && entryProps.isSelected ? 'true' : undefined}
      data-bookmark-tags={(bookmark.tags ?? []).map((tag) => tag.id).join(' ')}
    >
      <InlineBatchCheckbox {...entryProps} />
      <button
        type="button"
        className="pcanvas-row__open"
        onClick={entry.activate}
        title={entry.tooltip}
      >
        <BookmarkFavicon bookmark={bookmark} />
        <span className="pcanvas-row__text">
          <span className="pcanvas-row__title">{entry.title}</span>
          <span className="pcanvas-row__host">
            <BookmarkUrlText value={bookmarkHost(bookmark.url)} />
          </span>
        </span>
        {bookmark.is_pinned && (
          <Pin className="pcanvas-row__pin" size={12} aria-label={t('status.pinned')} />
        )}
      </button>
      <InlineEditButton {...entryProps} />
    </div>
  )
}
