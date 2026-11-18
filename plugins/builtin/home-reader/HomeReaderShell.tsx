import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, ExternalLink, Pencil, Pin } from 'lucide-react'
import { NotesButton } from '@/components/notes/NotesButton'
import type { Bookmark } from '@/lib/types'
import { BookmarkTagList } from '@/components/bookmarks/shared/BookmarkTagList'
import { BookmarkUrlText } from '@/components/bookmarks/shared/BookmarkUrlText'
import { TagButton } from '../layouts/TagButton'
import {
  BookmarkFavicon,
  InlineBatchCheckbox,
  bookmarkHost,
  useBookmarkEntry,
} from '../layouts/shared'
import {
  HomeShellRoot,
  ShellAllTagsButton,
  ShellListState,
  ShellLoadMore,
  ShellTagPanel,
  ShellToolbar,
  shellEntryProps,
  useShellTags,
  type HomeShellProps,
} from '../shells/home-shared'

/**
 * 三栏版式：像邮件客户端。左边是窄的标签列表，中间是紧凑的书签列表，
 * 右边是选中书签的详情（封面、描述、摘要、标签和操作），适合整理和回顾收藏。
 */
export function HomeReaderShell(shell: HomeShellProps) {
  const { t } = useTranslation('plugins')
  const { t: tt } = useTranslation('tags')
  const tags = useShellTags(shell)
  const [panelOpen, setPanelOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // 选中的书签被筛掉或删除后，回到列表第一条
  const active = shell.bookmarks.find((bookmark) => bookmark.id === activeId) ?? shell.bookmarks[0]

  const moveActive = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const index = shell.bookmarks.findIndex((bookmark) => bookmark.id === active?.id)
    const next = shell.bookmarks[index + (event.key === 'ArrowDown' ? 1 : -1)]
    if (!next) return
    event.preventDefault()
    setActiveId(next.id)
    const rows = listRef.current?.querySelectorAll<HTMLElement>('[data-row-id]')
    rows?.forEach((row) => {
      if (row.dataset.rowId === next.id) row.focus()
    })
  }

  return (
    <HomeShellRoot name="reader" shell={shell}>
      <aside className="pshell-reader__rail">
        <div className="pshell-reader__rail-head">
          <h2>{tt('title')}</h2>
          <ShellAllTagsButton onClick={() => setPanelOpen(true)} label={false} />
        </div>
        <div className="pshell-reader__rail-list">
          <button
            type="button"
            className="pshell-reader__tag"
            aria-pressed={shell.selectedTags.length === 0}
            data-state={shell.selectedTags.length === 0 ? 'selected' : undefined}
            onClick={() => shell.onTagsChange([])}
          >
            <span className="pshell-reader__tag-name">{t('shells.allBookmarks')}</span>
          </button>
          {tags.tags.map((tag) => (
            <TagButton key={tag.id} tag={tag} className="pshell-reader__tag" {...tags.chip}>
              <span className="pshell-reader__tag-name">{tag.name}</span>
              {tag.bookmark_count !== undefined && (
                <span className="pshell-reader__tag-count">{tag.bookmark_count}</span>
              )}
            </TagButton>
          ))}
        </div>
      </aside>

      <div className="pshell-reader__main">
        <div className="pshell-reader__toolbar">
          {shell.headerSlot}
          <ShellToolbar shell={shell} />
        </div>
        {shell.selectionPromptSlot}
        <div className="pshell-reader__panes">
          <div ref={listRef} className="pshell-reader__list" onKeyDown={moveActive}>
            <ShellListState shell={shell} />
            {!shell.isError &&
              shell.bookmarks.map((bookmark) => (
                <ReaderRow
                  key={bookmark.id}
                  shell={shell}
                  bookmark={bookmark}
                  active={bookmark.id === active?.id}
                  onActivate={() => setActiveId(bookmark.id)}
                />
              ))}
            {!shell.isError && <ShellLoadMore shell={shell} />}
          </div>
          {active && !shell.isError ? (
            <ReaderPreview key={active.id} shell={shell} bookmark={active} />
          ) : (
            <div className="pshell-reader__preview pshell-reader__preview--empty">
              <p>{t('shells.noSelection')}</p>
            </div>
          )}
        </div>
      </div>
      <ShellTagPanel shell={shell} isOpen={panelOpen} onClose={() => setPanelOpen(false)} />
    </HomeShellRoot>
  )
}

function ReaderRow({
  shell,
  bookmark,
  active,
  onActivate,
}: {
  shell: HomeShellProps
  bookmark: Bookmark
  active: boolean
  onActivate: () => void
}) {
  const { t } = useTranslation('bookmarks')
  const entryProps = shellEntryProps(shell, bookmark)
  const entry = useBookmarkEntry(entryProps)
  return (
    <div
      className="pshell-reader__row"
      data-active={active ? 'true' : undefined}
      data-batch-selected={shell.batchMode && entryProps.isSelected ? 'true' : undefined}
      data-bookmark-tags={(bookmark.tags ?? []).map((tag) => tag.id).join(' ')}
    >
      <InlineBatchCheckbox {...entryProps} />
      {/* 单击查看详情，双击或回车打开；批量模式下单击勾选 */}
      <button
        type="button"
        className="pshell-reader__row-open"
        data-row-id={bookmark.id}
        aria-current={active ? 'true' : undefined}
        title={entry.tooltip}
        onClick={() => {
          onActivate()
          if (shell.batchMode) entry.activate()
        }}
        onDoubleClick={() => {
          if (!shell.batchMode) entry.activate()
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || shell.batchMode) return
          event.preventDefault()
          entry.activate()
        }}
      >
        <BookmarkFavicon bookmark={bookmark} className="pshell-reader__row-icon" />
        <span className="pshell-reader__row-text">
          <span className="pshell-reader__row-title">{entry.title}</span>
          <span className="pshell-reader__row-host">
            <BookmarkUrlText value={bookmarkHost(bookmark.url)} />
          </span>
        </span>
        {bookmark.is_pinned && (
          <Pin className="pshell-reader__row-pin" size={12} aria-label={t('status.pinned')} />
        )}
      </button>
    </div>
  )
}

function previewImage(bookmark: Bookmark): string | undefined {
  return bookmark.cover_image?.trim() || bookmark.screenshot?.url || undefined
}

function ReaderPreview({ shell, bookmark }: { shell: HomeShellProps; bookmark: Bookmark }) {
  const { t, i18n } = useTranslation('plugins')
  const { t: tb } = useTranslation('bookmarks')
  // 详情里的“打开”始终打开书签，不受批量模式影响
  const entry = useBookmarkEntry({ ...shellEntryProps(shell, bookmark), batchMode: false })
  const image = previewImage(bookmark)
  const [imageFailed, setImageFailed] = useState(false)
  const [copied, setCopied] = useState(false)
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language]
  )
  const formatDate = (value?: string | null) => {
    const time = value ? new Date(value) : undefined
    return time && Number.isFinite(time.getTime()) ? dateFormat.format(time) : undefined
  }
  const created = formatDate(bookmark.created_at)
  const visited = formatDate(bookmark.last_clicked_at)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(bookmark.url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // 剪贴板不可用时不改变按钮状态
    }
  }

  return (
    <article className="pshell-reader__preview group">
      {image && !imageFailed && (
        <div className="pshell-reader__media">
          <img src={image} alt="" onError={() => setImageFailed(true)} />
        </div>
      )}
      <header className="pshell-reader__header">
        <BookmarkFavicon bookmark={bookmark} className="pshell-reader__icon" />
        <div className="pshell-reader__heading">
          <h2>{entry.title}</h2>
          <p>
            <BookmarkUrlText value={bookmark.url} />
          </p>
        </div>
      </header>
      <div className="pshell-reader__actions">
        <button type="button" className="btn btn-sm btn-primary" onClick={entry.activate}>
          <ExternalLink size={14} aria-hidden="true" />
          {t('shells.open')}
        </button>
        {!shell.readOnly && (
          <NotesButton
            target={{ kind: 'bookmark', id: bookmark.id, title: bookmark.title }}
            count={bookmark.note_count}
            className="w-8 h-8"
          />
        )}
        {shell.onEdit && !shell.readOnly && (
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => shell.onEdit?.(bookmark)}
          >
            <Pencil size={14} aria-hidden="true" />
            {tb('action.edit')}
          </button>
        )}
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => void copy()}>
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          {t(copied ? 'shells.copied' : 'shells.copyLink')}
        </button>
      </div>
      {bookmark.description && <p className="pshell-reader__text">{bookmark.description}</p>}
      {bookmark.ai_summary && (
        <section className="pshell-reader__block">
          <h3 className="pshell-heading">{t('shells.summary')}</h3>
          <p className="pshell-reader__text">{bookmark.ai_summary}</p>
        </section>
      )}
      <BookmarkTagList bookmark={bookmark} maxTags={12} />
      <dl className="pshell-reader__meta">
        {created && (
          <div>
            <dt>{t('shells.savedAt')}</dt>
            <dd>{created}</dd>
          </div>
        )}
        <div>
          <dt>{t('shells.visits')}</dt>
          <dd>{bookmark.click_count ?? 0}</dd>
        </div>
        {visited && (
          <div>
            <dt>{t('shells.lastVisit')}</dt>
            <dd>{visited}</dd>
          </div>
        )}
        <div>
          <dt>{t('shells.visibility')}</dt>
          <dd>{t(bookmark.is_public ? 'shells.public' : 'shells.private')}</dd>
        </div>
      </dl>
    </article>
  )
}
