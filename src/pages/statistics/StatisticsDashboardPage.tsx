import { useCallback, useMemo, useState } from 'react'
import { PluginSlot } from '@/plugins/PluginSlot'
import { useTranslation } from 'react-i18next'
import { useTags } from '@/hooks/useTags'
import type { Tag } from '@/lib/types'
import { useClickAnalytics } from './hooks/useClickAnalytics'
import { useChartStyle } from './hooks/useChartStyle'
import { useStatisticsFilters } from './hooks/useStatisticsFilters'
import { getUserTimeZone } from './utils/date'
import type { RankTab, SeriesSelection } from './utils/view'
import { FilterBar } from './components/FilterBar'
import { StatTiles } from './components/StatTiles'
import { TrendCard } from './components/TrendCard'
import { HeatmapCard } from './components/HeatmapCard'
import { SegmentedControl } from './components/SegmentedControl'
import { AgentUsageDashboard } from './components/AgentUsageDashboard'
import { useAgentAnalytics } from './hooks/useAgentAnalytics'
import type { AgentUsageSourceFilter } from '@shared/agent-usage-types'
import './statistics.css'

/** 页头：页面标题与副标题 */
function PageHeader() {
  const { t } = useTranslation('statistics')
  return (
    <div className="mb-3">
      <h1 className="text-xl font-bold text-foreground sm:text-2xl">{t('page.title')}</h1>
      <p className="mt-0.5 text-xs text-muted-foreground">{t('page.subtitle')}</p>
    </div>
  )
}

function CenteredSpinner({ label }: { label: string }) {
  return (
    <div className="flex min-h-[360px] items-center justify-center">
      <div className="text-center">
        <div
          className="mx-auto mb-3 h-9 w-9 animate-spin rounded-full border-b-2 border-primary"
          role="status"
          aria-label={label}
        />
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
    </div>
  )
}

/** 数据统计页：点击统计与 Agent 使用统计共用日期筛选。 */
export function StatisticsDashboardPage() {
  const { t, i18n } = useTranslation('statistics')
  const filters = useStatisticsFilters()
  const { style: chartStyle, setStyle: setChartStyle } = useChartStyle()

  // 序列与排行页签属于纯展示状态，不需要写进 URL
  const [series, setSeries] = useState<SeriesSelection>('all')
  const [rankTab, setRankTab] = useState<RankTab>('bookmarks')
  const [showTable, setShowTable] = useState(false)
  const [view, setView] = useState<'clicks' | 'agent'>('clicks')
  const [agentSource, setAgentSource] = useState<AgentUsageSourceFilter>('all')

  const timeZone = useMemo(() => getUserTimeZone(), [])
  const locale = i18n.language || 'zh-CN'

  const tagsQuery = useTags()
  const tags: Tag[] = tagsQuery.data?.tags ?? []

  const { data, isLoading, isFetching, isError, refetch } = useClickAnalytics({
    start: filters.rangeStart,
    end: filters.rangeEnd,
    granularity: filters.granularity,
    limit: filters.values.limit,
    tagId: filters.values.tagId,
    bookmarkId: filters.values.bookmarkId,
    enabled: filters.customError === null && view === 'clicks',
  })

  const agentQuery = useAgentAnalytics(
    {
      startDate: filters.rangeStart ?? undefined,
      endDate: filters.rangeEnd,
      tz: timeZone,
      granularity: filters.granularity,
      limit: filters.values.limit,
      source: agentSource,
    },
    filters.customError === null && view === 'agent'
  )

  const handleToggleBookmark = useCallback(
    (bookmarkId: string) => {
      filters.setBookmarkId(filters.values.bookmarkId === bookmarkId ? null : bookmarkId)
    },
    [filters]
  )

  const handleToggleTag = useCallback(
    (tagId: string) => {
      filters.setTagId(filters.values.tagId === tagId ? null : tagId)
    },
    [filters]
  )

  const handlePeakDay = useCallback(
    (date: string) => {
      filters.drillDown(date, date)
    },
    [filters]
  )

  const body = (() => {
    // 自定义区间非法时不发请求，只保留筛选条里的错误提示
    if (filters.customError !== null) {
      return (
        <p
          role="alert"
          className="rounded-xl border border-border bg-card px-3 py-6 text-center text-xs text-muted-foreground"
        >
          {t(`range.error.${filters.customError}`)}
        </p>
      )
    }
    if (view === 'agent') {
      return (
        <AgentUsageDashboard
          data={agentQuery.data}
          isLoading={agentQuery.isLoading}
          isFetching={agentQuery.isFetching}
          isError={agentQuery.isError}
          locale={locale}
          onRetry={() => void agentQuery.refetch()}
          onDrillDown={filters.drillDown}
        />
      )
    }
    if (isLoading && !data) return <CenteredSpinner label={t('page.loading')} />
    if (isError && !data) {
      return (
        <div className="flex min-h-[360px] items-center justify-center">
          <div className="text-center">
            <p className="mb-3 text-sm text-destructive">{t('page.loadFailed')}</p>
            <button
              type="button"
              onClick={refetch}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            >
              {t('page.retry')}
            </button>
          </div>
        </div>
      )
    }
    if (!data) return null

    // 刷新中降低不透明度；入场动画放在内层，避免 fill-mode 覆盖 opacity
    return (
      <div
        className={isFetching ? 'viz-refreshing' : undefined}
        aria-busy={isFetching || undefined}
      >
        <div
          key={`${data.range.start_date}-${data.range.end_date}-${data.range.granularity}-${
            data.filters.tag?.id ?? ''
          }-${data.filters.bookmark?.id ?? ''}-${data.range.days}`}
          className="viz-content-in flex flex-col gap-3"
        >
          <StatTiles data={data} locale={locale} onPeakDayClick={handlePeakDay} />

          <TrendCard
            data={data}
            locale={locale}
            chartStyle={chartStyle}
            onChartStyleChange={setChartStyle}
            series={series}
            onSeriesChange={setSeries}
            showTable={showTable}
            onToggleTable={() => setShowTable((current) => !current)}
            onDrillDown={filters.drillDown}
            rankTab={rankTab}
            onRankTabChange={setRankTab}
            onToggleBookmark={handleToggleBookmark}
            onToggleTag={handleToggleTag}
            below={<HeatmapCard heatmap={data.heatmap} locale={locale} embedded />}
          />

          {!data.tags_available ? (
            <p className="text-[11px] leading-4 text-muted-foreground">
              {t('page.tagsUnavailable')}
            </p>
          ) : null}
        </div>
      </div>
    )
  })()

  return (
    <div className="viz-root">
      <div className="viz-page">
        <PageHeader />

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl
              value={view}
              onChange={setView}
              ariaLabel={t('views.label')}
              options={[
                { value: 'clicks', label: t('views.clicks') },
                { value: 'agent', label: t('views.agent') },
              ]}
            />
            {view === 'agent' ? (
              <SegmentedControl<AgentUsageSourceFilter>
                value={agentSource}
                onChange={setAgentSource}
                ariaLabel={t('agent.source')}
                options={(['all', 'chat', 'agent_api', 'mcp'] as const).map((value) => ({
                  value,
                  label: t(`agent.sources.${value}`),
                }))}
              />
            ) : null}
          </div>
          <FilterBar
            preset={filters.values.preset}
            customStart={filters.values.customStart}
            customEnd={filters.values.customEnd}
            granularity={filters.granularity}
            rangeStart={filters.rangeStart}
            rangeEnd={filters.rangeEnd}
            rangeDays={filters.rangeDays}
            customError={filters.customError}
            todayKey={filters.todayKey}
            timeZone={timeZone}
            tags={tags}
            tagsAvailable={view === 'clicks' && (data ? data.tags_available : true)}
            tagId={filters.values.tagId}
            limit={filters.values.limit}
            appliedFilters={view === 'clicks' ? data?.filters : undefined}
            resolvedRange={view === 'clicks' ? data?.range : agentQuery.data?.range}
            onPresetChange={filters.setPreset}
            onCustomRangeChange={filters.setCustomRange}
            onGranularityChange={filters.setGranularity}
            onTagChange={filters.setTagId}
            onLimitChange={filters.setLimit}
            onClearTag={() => filters.setTagId(null)}
            onClearBookmark={() => filters.setBookmarkId(null)}
          />

          {body}
          <PluginSlot name="statistics" />
        </div>
      </div>
    </div>
  )
}
