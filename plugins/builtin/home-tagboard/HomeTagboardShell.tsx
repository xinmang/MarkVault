import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pin } from 'lucide-react'
import type { Bookmark } from '@/lib/types'
import { BookmarkUrlText } from '@/components/bookmarks/shared/BookmarkUrlText'
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
  ShellTagPanel,
  ShellToolbar,
  shellEntryProps,
  useShellTags,
  type HomeShellProps,
} from '../shells/home-shared'

/**
 * 标签看板版式：每个标签一列，列里是带这个标签的书签，横向滚动浏览。
 * 一条书签带几个标签就出现在几列；点击列标题按该标签筛选。适合按主题总览收藏。
 */
export function HomeTagboardShell(shell: HomeShellProps) {
  const { t } = useTranslation('plugins')
  const tags = useShellTags(shell)
  const [panelOpen, setPanelOpen] = useState(false)
  const columns = useMemo(
    () => tagColumns(shell.bookmarks, tags.tags),
    [shell.bookmarks, tags.tags]
  )

  return (
    <HomeShellRoot name="tagboard" shell={shell}>
      <div className="pshell-tagboard__bar">
        {shell.headerSlot}
        <ShellToolbar shell={shell} />
        <div className="pshell-tagboard__status">
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
        <div className="pshell-tagboard__columns">
          {columns.map((column) => (
            <section key={column.tag?.id ?? ''} className="pshell-tagboard__column">
              <header className="pshell-tagboard__header">
                {column.tag ? (
                  <TagButton tag={column.tag} className="pshell-tagboard__tag" {...tags.chip}>
                    <span className="pshell-tagboard__tag-name">{column.tag.name}</span>
                  </TagButton>
                ) : (
                  <span className="pshell-tagboard__tag-name">{t('shells.untagged')}</span>
                )}
                <span className="pshell-count">{column.items.length}</span>
              </header>
              <div className="pshell-tagboard__items">
                {column.items.map((bookmark) => (
                  <BoardRow key={bookmark.id} shell={shell} bookmark={bookmark} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      <ShellTagPanel shell={shell} isOpen={panelOpen} onClose={() => setPanelOpen(false)} />
    </HomeShellRoot>
  )
}

function BoardRow({ shell, bookmark }: { shell: HomeShellProps; bookmark: Bookmark }) {
  const { t } = useTranslation('bookmarks')
  const entryProps = shellEntryProps(shell, bookmark)
  const entry = useBookmarkEntry(entryProps)
  return (
    <div
      className="pshell-tagboard__row"
      data-batch-selected={shell.batchMode && entryProps.isSelected ? 'true' : undefined}
      data-bookmark-tags={(bookmark.tags ?? []).map((tag) => tag.id).join(' ')}
    >
      <InlineBatchCheckbox {...entryProps} />
      <button
        type="button"
        className="pshell-tagboard__open"
        onClick={entry.activate}
        title={entry.tooltip}
      >
        <BookmarkFavicon bookmark={bookmark} />
        <span className="pshell-tagboard__text">
          <span className="pshell-tagboard__title">{entry.title}</span>
          <span className="pshell-tagboard__host">
            <BookmarkUrlText value={bookmarkHost(bookmark.url)} />
          </span>
        </span>
        {bookmark.is_pinned && (
          <Pin className="pshell-tagboard__pin" size={12} aria-label={t('status.pinned')} />
        )}
      </button>
      <InlineEditButton {...entryProps} />
    </div>
  )
}
