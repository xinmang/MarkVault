import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pin } from 'lucide-react'
import type { Bookmark } from '@/lib/types'
import { useAuthStore } from '@/stores/authStore'
import { bookmarkLinkAttributes } from '@/components/bookmarks/TagLinkage'
import { BookmarkFavicon, useBookmarkEntry } from '../layouts/shared'
import { dayPart, quickAccessBookmarks } from '../shells/grouping'
import {
  HomeShellRoot,
  ShellAllTagsButton,
  ShellClearTagsButton,
  ShellResults,
  ShellTagChip,
  ShellTagPanel,
  ShellToolbar,
  shellEntryProps,
  useShellTags,
  type HomeShellProps,
} from '../shells/home-shared'

const TAG_COUNT = 14

/**
 * 起始页版式：像浏览器的新标签页。居中的问候语和搜索框，下面是常用标签、
 * 置顶与常访问书签组成的快捷访问，再往下才是完整的书签列表。整页一起滚动，没有侧栏。
 */
export function HomeLaunchpadShell(shell: HomeShellProps) {
  const { t, i18n } = useTranslation('plugins')
  const username = useAuthStore((state) => state.user?.username)
  const tags = useShellTags(shell)
  const [panelOpen, setPanelOpen] = useState(false)
  const filtering = shell.selectedTags.length > 0 || shell.searchKeyword.trim() !== ''
  const quick = useMemo(() => quickAccessBookmarks(shell.bookmarks), [shell.bookmarks])
  const today = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        month: 'long',
        day: 'numeric',
        weekday: 'long',
      }).format(new Date()),
    [i18n.language]
  )
  // 已选标签排在最前，至少保证它们和几个可继续筛选的标签都能看到
  const visibleTags = tags.tags.slice(0, Math.max(TAG_COUNT, shell.selectedTags.length + 6))

  return (
    <HomeShellRoot name="launchpad" shell={shell}>
      <div className="pshell-scroll pshell-launchpad__page">
        <header className="pshell-launchpad__hero">
          {shell.headerSlot}
          <h1 className="pshell-launchpad__greeting">
            {t('shells.greeting.' + dayPart())}
            {username && <span>{t('shells.greeting.name', { name: username })}</span>}
          </h1>
          <p className="pshell-launchpad__date">{today}</p>
          <div className="pshell-launchpad__search">
            <ShellToolbar shell={shell} />
          </div>
          <div className="pshell-launchpad__tags">
            {visibleTags.map((tag) => (
              <ShellTagChip key={tag.id} tag={tag} chip={tags.chip} />
            ))}
            <ShellAllTagsButton onClick={() => setPanelOpen(true)} />
            <ShellClearTagsButton shell={shell} />
          </div>
        </header>

        {shell.selectionPromptSlot}

        {!filtering && quick.length > 0 && (
          <section className="pshell-launchpad__section">
            <h2 className="pshell-heading">{t('shells.quickAccess')}</h2>
            <div className="pshell-launchpad__tiles">
              {quick.map((bookmark) => (
                <QuickTile key={bookmark.id} shell={shell} bookmark={bookmark} />
              ))}
            </div>
          </section>
        )}

        <section className="pshell-launchpad__section">
          <h2 className="pshell-heading">
            {t(filtering ? 'shells.results' : 'shells.allBookmarks')}
          </h2>
          <ShellResults shell={shell} />
        </section>
      </div>
      <ShellTagPanel shell={shell} isOpen={panelOpen} onClose={() => setPanelOpen(false)} />
    </HomeShellRoot>
  )
}

function QuickTile({ shell, bookmark }: { shell: HomeShellProps; bookmark: Bookmark }) {
  const { t } = useTranslation('bookmarks')
  const entryProps = shellEntryProps(shell, bookmark)
  const entry = useBookmarkEntry(entryProps)
  return (
    <button
      type="button"
      className="pshell-tile"
      {...bookmarkLinkAttributes(bookmark, 'card')}
      data-batch-selected={shell.batchMode && entryProps.isSelected ? 'true' : undefined}
      aria-pressed={shell.batchMode ? entryProps.isSelected : undefined}
      onClick={entry.activate}
      title={entry.tooltip}
    >
      <BookmarkFavicon bookmark={bookmark} className="pshell-tile__icon" />
      <span className="pshell-tile__title">{entry.title}</span>
      {bookmark.is_pinned && (
        <Pin className="pshell-tile__pin" size={12} aria-label={t('status.pinned')} />
      )}
    </button>
  )
}
