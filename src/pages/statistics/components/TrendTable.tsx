import { useTranslation } from 'react-i18next'
import type { AnalyticsResponse, AnalyticsTrendPoint } from '@/lib/types'
import { formatBucketFullLabel } from '../utils/format'

interface TrendTableProps {
  points: AnalyticsTrendPoint[]
  granularity: AnalyticsResponse['range']['granularity']
  locale: string
  showTag: boolean
  onDrillDown: (start: string, end: string) => void
}

/**
 * 趋势图的无障碍孪生视图：同一批桶，逐行列出。
 * 每一行都是一个下钻按钮（单日区间时不提供下钻）。
 */
export function TrendTable({ points, granularity, locale, showTag, onDrillDown }: TrendTableProps) {
  const { t } = useTranslation('statistics')

  return (
    <div className="max-h-[276px] overflow-y-auto">
      <table className="w-full border-collapse text-[11.5px]">
        <caption className="sr-only">{t('trend.tableCaption')}</caption>
        <thead>
          <tr className="text-muted-foreground">
            <th scope="col" className="sticky top-0 bg-card py-1.5 pr-2 text-left font-medium">
              {t('trend.tableBucket')}
            </th>
            <th scope="col" className="sticky top-0 bg-card py-1.5 pr-2 text-right font-medium">
              {t('trend.tableBookmark')}
            </th>
            {showTag ? (
              <th scope="col" className="sticky top-0 bg-card py-1.5 text-right font-medium">
                {t('trend.tableTag')}
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.bucket} className="viz-rank-row border-t border-border hover:bg-muted">
              <th scope="row" className="py-1 pr-2 text-left font-normal">
                <button
                  type="button"
                  onClick={() => onDrillDown(point.start_date, point.end_date)}
                  title={t('trend.tableDrill')}
                  className="rounded text-left text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                >
                  {formatBucketFullLabel(point.bucket, granularity, locale)}
                </button>
              </th>
              <td className="py-1 pr-2 text-right tabular-nums text-foreground">
                {point.bookmark_clicks}
              </td>
              {showTag ? (
                <td className="py-1 text-right tabular-nums text-foreground">{point.tag_clicks}</td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
