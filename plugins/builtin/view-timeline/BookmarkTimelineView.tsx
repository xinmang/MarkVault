import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { timelineGroups, type TimelineGroup } from '../layouts/grouping'
import { BookmarkRow, type BookmarkLayoutViewProps } from '../layouts/shared'

/** 时间线视图：按收藏时间分段，沿一条时间轴向下浏览。 */
export function BookmarkTimelineView({ bookmarks, selectedIds = [], ...rest }: BookmarkLayoutViewProps) {
  const { t, i18n } = useTranslation('plugins')
  const groups = useMemo(() => timelineGroups(bookmarks), [bookmarks])
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
  const heading = (group: TimelineGroup) =>
    group.period === 'month' ? monthFormat.format(group.start) : t('layouts.timeline.' + group.period)

  return (
    <ol className="layout-timeline">
      {groups.map((group) => (
        <li key={group.key} className="layout-timeline__period">
          <h3 className="layout-group-heading">
            <span>{heading(group)}</span>
            <span className="layout-group-count">{group.items.length}</span>
          </h3>
          <div className="layout-rows">
            {group.items.map((bookmark, index) => {
              const created = new Date(bookmark.created_at)
              const valid = Number.isFinite(created.getTime())
              const recent = group.period === 'today' || group.period === 'yesterday'
              return (
                <BookmarkRow
                  key={bookmark.id}
                  view="timeline"
                  index={index}
                  bookmark={bookmark}
                  isSelected={selectedIds.includes(bookmark.id)}
                  meta={
                    valid && (
                      <time dateTime={created.toISOString()}>
                        {(recent ? timeFormat : dayFormat).format(created)}
                      </time>
                    )
                  }
                  {...rest}
                />
              )
            })}
          </div>
        </li>
      ))}
    </ol>
  )
}
