import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import {
  HomeShellRoot,
  ShellAllTagsButton,
  ShellClearTagsButton,
  ShellResults,
  ShellTagChip,
  ShellTagPanel,
  ShellToolbar,
  useShellTags,
  type HomeShellProps,
} from '../shells/home-shared'

/**
 * 顶栏版式：没有侧栏。标签收成工具栏下方的一条横向标签带，书签占满整个页面宽度，
 * 适合宽屏和喜欢卡片墙的人。标签带可以展开成多行，完整的标签面板从抽屉打开。
 */
export function HomeTopbarShell(shell: HomeShellProps) {
  const { t } = useTranslation('plugins')
  const tags = useShellTags(shell)
  const [expanded, setExpanded] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)

  return (
    <HomeShellRoot name="topbar" shell={shell}>
      <div className="pshell-topbar__bar">
        {shell.headerSlot}
        <ShellToolbar shell={shell} />
        <div className="pshell-topbar__tags">
          <ShellAllTagsButton onClick={() => setPanelOpen(true)} label={false} />
          <div
            className="pshell-topbar__strip"
            data-expanded={expanded ? 'true' : undefined}
            role="group"
            aria-label={t('shells.tagStrip')}
          >
            {tags.tags.map((tag) => (
              <ShellTagChip key={tag.id} tag={tag} chip={tags.chip} />
            ))}
            {!tags.isLoading && tags.tags.length === 0 && (
              <span className="pshell-topbar__empty">{t('shells.noTags')}</span>
            )}
          </div>
          <ShellClearTagsButton shell={shell} />
          {tags.tags.length > 0 && (
            <button
              type="button"
              className="pshell-pill"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
              title={t(expanded ? 'shells.collapseTags' : 'shells.expandTags')}
              aria-label={t(expanded ? 'shells.collapseTags' : 'shells.expandTags')}
            >
              <ChevronDown className="pshell-chevron" size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      {shell.selectionPromptSlot}
      <div className="pshell-scroll">
        <ShellResults shell={shell} />
      </div>
      <ShellTagPanel shell={shell} isOpen={panelOpen} onClose={() => setPanelOpen(false)} />
    </HomeShellRoot>
  )
}
