import { useTranslation } from 'react-i18next'
import type { AnalyticsResponse } from '@/lib/types'
import { formatBucketLabel, formatCompactNumber, computeClickDelta } from '../utils/format'

interface StatTilesProps {
  data: AnalyticsResponse
  locale: string
  /** 下钻到峰值日 */
  onPeakDayClick: (date: string) => void
}

interface CellProps {
  label: string
  value: string
  sub: string
  onClick?: () => void
  clickLabel?: string
  title?: string
}

/**
 * 一个 KPI 格子。分割线由 CSS 的发丝边框提供（见 statistics.css 的 .viz-kpi），
 * 所以这里不需要任何 border/gap 逻辑。
 */
function KpiCell({ label, value, sub, onClick, clickLabel, title }: CellProps) {
  const body = (
    <>
      <div className="truncate text-[11px] leading-4 text-muted-foreground">{label}</div>
      <div
        className="mt-0.5 truncate text-[22px] font-semibold leading-[1.2] tracking-[-0.02em] text-foreground"
        title={value}
      >
        {value}
      </div>
      <div className="mt-0.5 truncate text-[11px] leading-4 text-muted-foreground" title={sub}>
        {sub}
      </div>
    </>
  )

  if (!onClick) {
    return <div className="viz-kpi-cell">{body}</div>
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={clickLabel}
      title={title ?? clickLabel}
      className="viz-kpi-cell w-full cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    >
      {body}
    </button>
  )
}

/** 单卡片 KPI 条：每列之间只有一根发丝线 */
export function StatTiles({ data, locale, onPeakDayClick }: StatTilesProps) {
  const { t } = useTranslation('statistics')
  const { summary, range } = data
  const tagsAvailable = data.tags_available && !data.filters.bookmark

  const bookmarkDelta = computeClickDelta(summary.bookmark_clicks, summary.previous.bookmark_clicks)
  const tagDelta = computeClickDelta(summary.tag_clicks, summary.previous.tag_clicks)

  const deltaText = (delta: ReturnType<typeof computeClickDelta>): string => {
    if (delta.direction === 'none' || delta.percent === null) return t('kpi.deltaNoPrevious')
    if (delta.direction === 'flat') return t('kpi.deltaFlat')
    return t(delta.direction === 'up' ? 'kpi.deltaUp' : 'kpi.deltaDown', {
      percent: delta.percent,
    })
  }

  const peak = summary.peak_day
  const peakValue = peak ? formatBucketLabel(peak.date, 'day', locale) : '—'
  const peakSub = peak
    ? t('kpi.peakDayValue', { count: peak.bookmark_clicks + peak.tag_clicks })
    : t('kpi.noPeak')

  return (
    <section
      aria-label={t('page.title')}
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className="viz-kpi" data-count={tagsAvailable ? 5 : 4}>
        <KpiCell
          label={t('kpi.bookmarkClicks')}
          value={formatCompactNumber(summary.bookmark_clicks, locale)}
          sub={deltaText(bookmarkDelta)}
        />

        {tagsAvailable ? (
          <KpiCell
            label={t('kpi.tagClicks')}
            value={formatCompactNumber(summary.tag_clicks, locale)}
            sub={`${deltaText(tagDelta)} · ${t('kpi.tagsInvolved', { count: summary.tags_clicked })}`}
          />
        ) : null}

        <KpiCell
          label={t('kpi.bookmarksClicked')}
          value={formatCompactNumber(summary.bookmarks_clicked, locale)}
          sub={t('kpi.totalClicksSub', { count: summary.bookmark_clicks })}
        />

        <KpiCell
          label={t('kpi.activeDays')}
          value={`${summary.active_days} / ${range.days}`}
          sub={t('kpi.daysUnit')}
        />

        <KpiCell
          label={t('kpi.peakDay')}
          value={peakValue}
          sub={peakSub}
          onClick={peak ? () => onPeakDayClick(peak.date) : undefined}
          clickLabel={
            peak
              ? `${t('kpi.peakDay')} ${peakValue} ${peakSub} · ${t('kpi.peakDayHint')}`
              : undefined
          }
        />
      </div>
    </section>
  )
}
