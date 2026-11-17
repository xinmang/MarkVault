import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Folder } from 'lucide-react'
import { tabStripEntries } from '../shells/grouping'
import { TabShellFrame, TabShellHeader, type TabShellProps } from '../shells/tab-shared'

/**
 * 顶部分组栏版式：分组从左侧的树换成工具栏下方的一条横向分组栏，像浏览器的标签栏，
 * 点一下只看这个分组。内容区占满整个宽度，分组树和待办收进抽屉。
 */
export function TabsTabbedShell(shell: TabShellProps) {
  const { t } = useTranslation('plugins')
  const { tabGroups, selectedGroupId } = shell.grid
  const entries = useMemo(() => tabStripEntries(tabGroups), [tabGroups])
  const total = entries.reduce((sum, entry) => sum + (entry.depth === 0 ? entry.count : 0), 0)

  return (
    <TabShellFrame name="tabbed">
      <TabShellHeader shell={shell} />
      {tabGroups.length > 0 && (
        <nav className="pshell-strip" aria-label={t('shells.groupStrip')}>
          <button
            type="button"
            className="pshell-strip__tab"
            aria-pressed={selectedGroupId === null}
            onClick={() => shell.onSelectGroup(null)}
          >
            <span className="pshell-strip__name">{t('shells.allGroups')}</span>
            <span className="pshell-count">{total}</span>
          </button>
          {entries.map(({ group, depth, count }) => (
            <button
              key={group.id}
              type="button"
              className="pshell-strip__tab"
              data-child={depth > 0 ? 'true' : undefined}
              aria-pressed={selectedGroupId === group.id}
              onClick={() => shell.onSelectGroup(group.id)}
              title={group.title}
            >
              {group.is_folder === 1 && <Folder size={14} aria-hidden="true" />}
              <span className="pshell-strip__name">{group.title}</span>
              <span className="pshell-count">{count}</span>
            </button>
          ))}
        </nav>
      )}
      <div className="pshell-tabs__scroll">{shell.renderGroups()}</div>
    </TabShellFrame>
  )
}
