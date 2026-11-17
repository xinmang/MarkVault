import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { timelineGroups, type TimelineGroup } from '../layouts/grouping'
import type { TabLayoutProps } from '../layouts/tab-shared'
import type { TabGroup } from '@/lib/types'
import {
  ShellGroupCard,
  TabShellFrame,
  TabShellHeader,
  folderNames,
  type TabShellProps,
} from '../shells/tab-shared'

/**
 * 收纳时间线版式：按收纳时间把分组排成一条时间线（今天、昨天、近 7 天、各个月份），
 * 左侧是时间，右侧是那段时间收纳的分组。适合把标签页组当作“稍后再看”的收纳记录。
 */
export function TabsTimelineShell(shell: TabShellProps) {
  return (
    <TabShellFrame name="timeline">
      <TabShellHeader shell={shell} />
      <div className="pshell-tabs__scroll">{shell.renderGroups(TimelineView)}</div>
    </TabShellFrame>
  )
}

function TimelineView({ groups, ...gridProps }: TabLayoutProps) {
  const { t, i18n } = useTranslation('plugins')
  const periods = useMemo(() => timelineGroups(groups), [groups])
  const folders = useMemo(() => folderNames(gridProps.tabGroups), [gridProps.tabGroups])
  const monthFormat = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { year: 'numeric', month: 'long' }),
    [i18n.language]
  )
  const dayFormat = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { month: 'numeric', day: 'numeric' }),
    [i18n.language]
  )
  const timeFormat = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }),
    [i18n.language]
  )
  const heading = (period: TimelineGroup<TabGroup>) =>
    period.period === 'month'
      ? monthFormat.format(period.start)
      : t('layouts.timeline.' + period.period)

  return (
    <ol className="pshell-timeline">
      {periods.map((period) => {
        const recent = period.period === 'today' || period.period === 'yesterday'
        const tabCount = period.items.reduce((sum, group) => sum + (group.items?.length ?? 0), 0)
        return (
          <li key={period.key} className="pshell-timeline__period">
            <div className="pshell-timeline__label">
              <h2>{heading(period)}</h2>
              <p>{t('shells.timelineSummary', { groups: period.items.length, tabs: tabCount })}</p>
            </div>
            <div className="pshell-timeline__cards">
              {period.items.map((group) => {
                const created = new Date(group.created_at)
                return (
                  <ShellGroupCard
                    key={group.id}
                    gridProps={gridProps}
                    group={group}
                    folder={group.parent_id ? folders.get(group.parent_id) : undefined}
                    compact={false}
                    meta={
                      Number.isFinite(created.getTime()) && (
                        <time dateTime={created.toISOString()}>
                          {(recent ? timeFormat : dayFormat).format(created)}
                        </time>
                      )
                    }
                  />
                )
              })}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
