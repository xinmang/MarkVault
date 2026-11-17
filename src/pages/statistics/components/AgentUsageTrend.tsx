import { useTranslation } from 'react-i18next'
import type { AgentAnalyticsResponse } from '@shared/agent-usage-types'
import { useElementWidth } from '../hooks/useElementWidth'
import { niceTicks, pickLabelIndices, scaleMaxFor } from '../utils/chart'
import { formatBucketFullLabel, formatBucketLabel, formatCompactNumber } from '../utils/format'
import { EmptyState } from './EmptyState'
import { AGENT_COLORS, AGENT_SOURCES } from '../utils/agent'

interface AgentUsageTrendProps {
  data: AgentAnalyticsResponse
  locale: string
  onDrillDown: (start: string, end: string) => void
}

/** 柱形按来源堆叠；每个时间桶支持鼠标、触屏与键盘下钻。 */
export function AgentUsageTrend({ data, locale, onDrillDown }: AgentUsageTrendProps) {
  const { t } = useTranslation('statistics')
  const { ref, width } = useElementWidth<HTMLDivElement>()
  const points = data.trend
  const max = Math.max(0, ...points.map((point) => point.chat + point.agent_api + point.mcp))
  const chartWidth = Math.max(width, 320)
  const left = 38
  const plotWidth = chartWidth - left - 8
  const plotHeight = 200
  const baseline = 214
  const ticks = niceTicks(max, 4)
  const scale = scaleMaxFor(max, 4)
  const slot = plotWidth / Math.max(points.length, 1)
  const labels = new Set(pickLabelIndices(points.length, plotWidth, 70))

  return (
    <div ref={ref} className="min-w-0">
      {max === 0 ? (
        <EmptyState message={t('agent.empty')} />
      ) : (
        <div className="overflow-x-auto">
          <svg width={chartWidth} height={246} role="group" aria-label={t('agent.trendTitle')}>
            {ticks.map((tick) => {
              const y = baseline - (tick / scale) * plotHeight
              return (
                <g key={tick} aria-hidden="true">
                  <line x1={left} x2={chartWidth - 8} y1={y} y2={y} stroke="var(--border)" />
                  <text
                    x={left - 7}
                    y={y + 3}
                    textAnchor="end"
                    fontSize={10}
                    fill="var(--muted-foreground)"
                  >
                    {formatCompactNumber(tick, locale)}
                  </text>
                </g>
              )
            })}
            {points.map((point, index) => {
              const label = formatBucketFullLabel(point.bucket, data.range.granularity, locale)
              const description = `${label} · ${AGENT_SOURCES.map((source) => `${t(`agent.sources.${source}`)} ${point[source]}`).join(' · ')}`
              const x = left + index * slot
              let stacked = 0
              return (
                <g
                  key={point.bucket}
                  tabIndex={0}
                  role="button"
                  aria-label={`${description} · ${t('trend.tableDrill')}`}
                  className="cursor-pointer focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={() => onDrillDown(point.start_date, point.end_date)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onDrillDown(point.start_date, point.end_date)
                    }
                  }}
                >
                  <title>{description}</title>
                  <rect x={x} y={14} width={slot} height={plotHeight} fill="transparent" />
                  {AGENT_SOURCES.map((source) => {
                    const height = (point[source] / scale) * plotHeight
                    stacked += height
                    return (
                      <rect
                        key={source}
                        x={x + slot * 0.2}
                        y={baseline - stacked}
                        width={slot * 0.6}
                        height={height}
                        fill={AGENT_COLORS[source]}
                      />
                    )
                  })}
                  {labels.has(index) ? (
                    <text
                      x={x + slot / 2}
                      y={234}
                      textAnchor="middle"
                      fontSize={10}
                      fill="var(--muted-foreground)"
                    >
                      {formatBucketLabel(point.bucket, data.range.granularity, locale)}
                    </text>
                  ) : null}
                </g>
              )
            })}
          </svg>
        </div>
      )}
    </div>
  )
}
