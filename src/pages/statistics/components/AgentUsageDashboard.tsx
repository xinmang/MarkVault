import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentAnalyticsResponse } from '@shared/agent-usage-types'
import { formatBucketFullLabel, formatCompactNumber } from '../utils/format'
import { AgentUsageTrend } from './AgentUsageTrend'
import { AGENT_COLORS, AGENT_SOURCES } from '../utils/agent'
import { EmptyState } from './EmptyState'

interface AgentUsageDashboardProps {
  data: AgentAnalyticsResponse | undefined
  isLoading: boolean
  isFetching: boolean
  isError: boolean
  locale: string
  onRetry: () => void
  onDrillDown: (start: string, end: string) => void
}

export function AgentUsageDashboard({
  data,
  isLoading,
  isFetching,
  isError,
  locale,
  onRetry,
  onDrillDown,
}: AgentUsageDashboardProps) {
  const { t } = useTranslation('statistics')
  const [showTable, setShowTable] = useState(false)
  const number = (value: number) => formatCompactNumber(value, locale)
  const rate = (value: number | null) => (value === null ? '—' : `${value.toLocaleString(locale)}%`)
  const duration = (value: number | null) =>
    value === null ? '—' : t('agent.durationValue', { value: value.toLocaleString(locale) })

  if (!data) {
    return (
      <div className="flex min-h-[300px] items-center justify-center rounded-xl border border-border bg-card">
        {isError ? (
          <div role="alert" className="text-center">
            <p className="mb-3 text-sm text-destructive">{t('page.loadFailed')}</p>
            <button type="button" onClick={onRetry} className="btn btn-secondary">
              {t('page.retry')}
            </button>
          </div>
        ) : isLoading ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t('page.loading')}
          </p>
        ) : null}
      </div>
    )
  }

  const summary = data.summary
  const tiles = [
    {
      label: t('agent.totalCalls'),
      value: number(summary.calls),
      sub: t('agent.failedCalls', { count: summary.failed_calls }),
    },
    {
      label: t('agent.toolCalls'),
      value: number(summary.tool_calls),
      sub: t('agent.toolCallsHint'),
    },
    {
      label: t('agent.successRate'),
      value: rate(summary.success_rate),
      sub: t('agent.successfulCalls', { count: summary.successful_calls }),
    },
    {
      label: t('agent.avgDuration'),
      value: duration(summary.avg_duration_ms),
      sub: t('agent.durationHint'),
    },
    {
      label: t('kpi.activeDays'),
      value: `${summary.active_days} / ${data.range.days}`,
      sub: t('kpi.daysUnit'),
    },
  ]

  return (
    <div
      className={`flex flex-col gap-3 ${isFetching ? 'viz-refreshing' : ''}`}
      aria-busy={isFetching}
    >
      {isError ? (
        <p role="alert" className="text-xs text-destructive">
          {t('agent.refreshFailed')}{' '}
          <button type="button" onClick={onRetry} className="underline">
            {t('page.retry')}
          </button>
        </p>
      ) : null}
      <section
        aria-label={t('agent.overview')}
        className="overflow-hidden rounded-xl border border-border bg-card"
      >
        <div className="viz-kpi" data-count="5">
          {tiles.map((tile) => (
            <div key={tile.label} className="viz-kpi-cell">
              <div className="text-[11px] text-muted-foreground">{tile.label}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-foreground">
                {tile.value}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">{tile.sub}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        {data.sources.map((source) => (
          <section
            key={source.source}
            aria-label={t(`agent.sources.${source.source}`)}
            className="rounded-xl border border-border bg-card p-3"
          >
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: AGENT_COLORS[source.source] }}
                aria-hidden="true"
              />
              {t(`agent.sources.${source.source}`)}
            </div>
            <div className="mt-1 text-xl font-semibold tabular-nums text-foreground">
              {number(source.calls)}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t('agent.sourceSummary', {
                rate: rate(source.success_rate),
                count: source.failed_calls,
              })}
            </p>
          </section>
        ))}
      </div>

      <section
        className="rounded-xl border border-border bg-card p-3"
        aria-label={t('agent.trendTitle')}
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">{t('agent.trendTitle')}</h2>
          <button
            type="button"
            aria-pressed={showTable}
            onClick={() => setShowTable((value) => !value)}
            className="rounded-lg border border-border px-2 py-1 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            {t(showTable ? 'trend.showChart' : 'trend.showTable')}
          </button>
        </div>
        {showTable ? (
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-left text-xs tabular-nums">
              <caption className="sr-only">{t('agent.trendTitle')}</caption>
              <thead className="sticky top-0 bg-card text-muted-foreground">
                <tr>
                  <th scope="col" className="p-2">
                    {t('trend.tableBucket')}
                  </th>
                  {AGENT_SOURCES.map((source) => (
                    <th scope="col" className="p-2 text-right" key={source}>
                      {t(`agent.sources.${source}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.trend.map((point) => (
                  <tr key={point.bucket} className="border-t border-border text-foreground">
                    <th scope="row" className="p-2 font-normal">
                      <button
                        type="button"
                        className="text-primary underline"
                        title={t('trend.tableDrill')}
                        onClick={() => onDrillDown(point.start_date, point.end_date)}
                      >
                        {formatBucketFullLabel(point.bucket, data.range.granularity, locale)}
                      </button>
                    </th>
                    {AGENT_SOURCES.map((source) => (
                      <td key={source} className="p-2 text-right">
                        {point[source].toLocaleString(locale)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <AgentUsageTrend data={data} locale={locale} onDrillDown={onDrillDown} />
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">{t('agent.trendHint')}</p>
      </section>

      <section
        className="rounded-xl border border-border bg-card p-3"
        aria-label={t('agent.operationsTitle')}
      >
        <h2 className="text-sm font-semibold text-foreground">{t('agent.operationsTitle')}</h2>
        <p className="mt-1 text-[11px] text-muted-foreground">{t('agent.operationsHint')}</p>
        {data.top_operations.length === 0 ? (
          <EmptyState message={t('agent.noOperations')} />
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <caption className="sr-only">{t('agent.operationsTitle')}</caption>
              <thead className="text-muted-foreground">
                <tr>
                  {[
                    t('agent.operation'),
                    t('agent.source'),
                    t('agent.totalCalls'),
                    t('agent.failed'),
                    t('agent.avgDuration'),
                  ].map((label, index) => (
                    <th
                      scope="col"
                      key={label}
                      className={`whitespace-nowrap p-2 ${index > 1 ? 'text-right' : ''}`}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.top_operations.map((operation) => (
                  <tr
                    key={`${operation.source}:${operation.operation}`}
                    className="border-t border-border text-foreground"
                  >
                    <th scope="row" className="p-2 text-left font-mono font-normal break-all">
                      {operation.operation === 'unknown_tool'
                        ? t('agent.unknownTool')
                        : operation.operation}
                    </th>
                    <td className="whitespace-nowrap p-2 text-muted-foreground">
                      {t(`agent.sources.${operation.source}`)}
                    </td>
                    <td className="p-2 text-right tabular-nums">{number(operation.calls)}</td>
                    <td
                      className={`p-2 text-right tabular-nums ${operation.failed_calls > 0 ? 'text-destructive' : ''}`}
                    >
                      {number(operation.failed_calls)}
                    </td>
                    <td className="whitespace-nowrap p-2 text-right tabular-nums">
                      {duration(operation.avg_duration_ms)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="text-[11px] leading-5 text-muted-foreground">{t('agent.countingHint')}</p>
      <p className="text-[11px] leading-5 text-muted-foreground">{t('agent.historyHint')}</p>
    </div>
  )
}
