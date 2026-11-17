import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { BarChart3, LineChart, Table2 } from 'lucide-react'
import type { AnalyticsResponse } from '@/lib/types'
import type { ChartStyle, RankTab, SeriesSelection } from '../utils/view'
import { formatBucketFullLabel } from '../utils/format'
import { SegmentedControl, type SegmentedOption } from './SegmentedControl'
import { TrendChart } from './TrendChart'
import { TrendTable } from './TrendTable'
import { HourlyBarChart } from './HourlyBarChart'
import { RankColumn } from './RankColumn'

interface TrendCardProps {
  data: AnalyticsResponse
  locale: string
  /** 图表样式（受控，持久化在 localStorage） */
  chartStyle: ChartStyle
  onChartStyleChange: (style: ChartStyle) => void
  /** 可见序列（受控，切换筛选后保持） */
  series: SeriesSelection
  onSeriesChange: (series: SeriesSelection) => void
  /** 表格视图开关 */
  showTable: boolean
  onToggleTable: () => void
  onDrillDown: (start: string, end: string) => void
  rankTab: RankTab
  onRankTabChange: (tab: RankTab) => void
  onToggleBookmark: (bookmarkId: string) => void
  onToggleTag: (tagId: string) => void
  /** 渲染在图表下方（左列）的内容，例如时段热力图 */
  below?: ReactNode
}

/**
 * 「账本」式趋势卡：工具栏（序列切换 / 图表样式 / 表格）+
 * 主体两列（图或表 + 排行列）+ 底部标签口径说明。
 */
export function TrendCard({
  data,
  locale,
  chartStyle,
  onChartStyleChange,
  series,
  onSeriesChange,
  showTable,
  onToggleTable,
  onDrillDown,
  rankTab,
  onRankTabChange,
  onToggleBookmark,
  onToggleTag,
  below,
}: TrendCardProps) {
  const { t } = useTranslation('statistics')

  const tagsAvailable = data.tags_available && !data.filters.bookmark
  const isSingleDay = data.range.days === 1
  const effectiveSeries: SeriesSelection = series === 'tag' && !tagsAvailable ? 'all' : series

  const seriesOptions: SegmentedOption<SeriesSelection>[] = [
    { value: 'all', label: t('trend.seriesAll') },
    { value: 'bookmark', label: t('trend.seriesBookmark') },
  ]
  if (tagsAvailable) {
    seriesOptions.push({ value: 'tag', label: t('trend.seriesTag') })
  }

  const styleOptions: SegmentedOption<ChartStyle>[] = [
    {
      value: 'bar',
      icon: <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />,
      ariaLabel: t('trend.styleBar'),
    },
    {
      value: 'line',
      icon: <LineChart className="h-3.5 w-3.5" aria-hidden="true" />,
      ariaLabel: t('trend.styleLine'),
    },
  ]

  return (
    <section
      aria-label={t('trend.title')}
      className="rounded-xl border border-border bg-card px-[14px] py-[10px]"
    >
      <div className="mb-1 flex flex-wrap items-center gap-2">
        {/* 单日区间只有书签点击按小时分布，序列与样式切换此时无意义 */}
        {!isSingleDay ? (
          <>
            <SegmentedControl
              options={seriesOptions}
              value={effectiveSeries}
              onChange={onSeriesChange}
              ariaLabel={t('trend.seriesLabel')}
            />
            <SegmentedControl
              options={styleOptions}
              value={chartStyle}
              onChange={onChartStyleChange}
              ariaLabel={t('trend.styleLabel')}
            />
          </>
        ) : null}

        <button
          type="button"
          aria-pressed={showTable}
          aria-label={t('trend.toggleView')}
          onClick={onToggleTable}
          className={`ml-auto inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11.5px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring ${
            showTable
              ? 'bg-muted font-medium text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Table2 className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{t('trend.showTable')}</span>
        </button>
      </div>

      <div className="viz-led-body">
        <div className="min-w-0">
          {showTable ? (
            <TrendTable
              points={data.trend}
              granularity={data.range.granularity}
              locale={locale}
              showTag={effectiveSeries !== 'bookmark'}
              onDrillDown={onDrillDown}
            />
          ) : isSingleDay ? (
            <figure className="m-0">
              <figcaption className="mb-1 text-[10.5px] text-muted-foreground">
                {t('hourly.description')}
              </figcaption>
              <HourlyBarChart
                heatmap={data.heatmap}
                locale={locale}
                dateLabel={formatBucketFullLabel(data.range.start_date, 'day', locale)}
              />
            </figure>
          ) : (
            <figure className="m-0">
              <figcaption className="sr-only">
                {t('trend.title')} — {t('trend.description')}
              </figcaption>
              <TrendChart
                data={data}
                locale={locale}
                chartStyle={chartStyle}
                series={effectiveSeries}
                onDrillDown={onDrillDown}
              />
            </figure>
          )}
          {below}
        </div>

        <div className="min-w-0 border-t border-border pt-2 lg:border-l lg:border-t-0 lg:pl-[18px] lg:pt-0">
          <RankColumn
            data={data}
            locale={locale}
            tab={rankTab}
            onTabChange={onRankTabChange}
            showTags={tagsAvailable}
            onToggleBookmark={onToggleBookmark}
            onToggleTag={onToggleTag}
          />
        </div>
      </div>

      {tagsAvailable ? (
        <p className="mt-2 text-[11px] leading-4 text-muted-foreground/70">
          {t('rank.tagsFootnote')}
        </p>
      ) : null}
    </section>
  )
}
