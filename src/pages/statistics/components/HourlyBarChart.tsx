import {
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useElementWidth } from '../hooks/useElementWidth'
import { barSlotGeometry, buildBarPath, niceTicks, scaleMaxFor } from '../utils/chart'
import { formatCompactNumber, maxValueIndex, padHour } from '../utils/format'
import { sumHeatmapHours } from '../utils/heatmap'
import { ChartTooltip } from './ChartTooltip'
import { EmptyState } from './EmptyState'

const PLOT_HEIGHT = 236
const AXIS_BAND = 22
const TOP_PAD = 18
const LEFT_PAD = 34
const RIGHT_PAD = 8

interface HourlyBarChartProps {
  /** 服务端原始 heatmap（0=周日），可能不是 7×24 */
  heatmap: number[][]
  locale: string
  /** 这一天的完整日期文案，用于无障碍名称 */
  dateLabel: string
}

interface HoverState {
  hour: number
  x: number
  y: number
}

/**
 * 单日区间专用：把 7×24 的热力矩阵按小时求和，得到 24 根柱子。
 * 柱子从同一条基线生长，只给最高的一根标数值。
 */
export function HourlyBarChart({ heatmap, locale, dateLabel }: HourlyBarChartProps) {
  const { t } = useTranslation('statistics')
  const { ref, width } = useElementWidth<HTMLDivElement>()
  const [hover, setHover] = useState<HoverState | null>(null)

  const hourly = useMemo(() => sumHeatmapHours(heatmap), [heatmap])
  const maxValue = useMemo(() => {
    const index = maxValueIndex(hourly)
    return index >= 0 ? (hourly[index] ?? 0) : 0
  }, [hourly])

  const ticks = useMemo(() => niceTicks(maxValue, 3), [maxValue])
  const scaleMax = useMemo(() => scaleMaxFor(maxValue, 3), [maxValue])

  const safeWidth = Math.max(0, width)
  const plotWidth = Math.max(0, safeWidth - LEFT_PAD - RIGHT_PAD)
  const baselineY = TOP_PAD + PLOT_HEIGHT
  const { slot, barWidth } = barSlotGeometry(plotWidth, 24, 24, 0.66)

  const yFor = useCallback(
    (value: number) => {
      const safe = Number.isFinite(value) && value > 0 ? value : 0
      return baselineY - (safe / scaleMax) * PLOT_HEIGHT
    },
    [baselineY, scaleMax]
  )

  const centerFor = useCallback((hour: number) => LEFT_PAD + slot * hour + slot / 2, [slot])

  const hasData = maxValue > 0

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!hasData || slot <= 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const localX = event.clientX - rect.left
    const hour = Math.min(23, Math.max(0, Math.floor((localX - LEFT_PAD) / slot)))
    setHover({ hour, x: centerFor(hour), y: event.clientY - rect.top })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!hasData) return
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      const delta = event.key === 'ArrowRight' ? 1 : -1
      const current = hover ? hover.hour : -1
      const next = Math.min(23, Math.max(0, (current < 0 ? 23 : current) + delta))
      setHover({ hour: next, x: centerFor(next), y: baselineY })
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setHover(null)
    }
  }

  const hoveredValue = hover ? (hourly[hover.hour] ?? 0) : 0

  return (
    <div
      ref={ref}
      className="viz-plot"
      style={{ height: PLOT_HEIGHT + TOP_PAD + AXIS_BAND }}
      tabIndex={hasData ? 0 : -1}
      role="group"
      aria-label={t('hourly.title', { date: dateLabel })}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setHover(null)}
      onBlur={() => setHover(null)}
      onKeyDown={handleKeyDown}
    >
      {!hasData ? (
        <EmptyState message={t('hourly.empty')} compact />
      ) : (
        <svg
          width={safeWidth || 1}
          height={PLOT_HEIGHT + TOP_PAD + AXIS_BAND}
          role="img"
          aria-hidden="true"
          className="block overflow-visible"
        >
          {ticks.map((tick) => {
            const y = yFor(tick)
            return (
              <g key={`hour-tick-${tick}`}>
                <line
                  x1={LEFT_PAD}
                  x2={LEFT_PAD + plotWidth}
                  y1={y}
                  y2={y}
                  stroke="var(--border)"
                  strokeWidth={1}
                />
                <text
                  x={LEFT_PAD - 6}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-muted-foreground text-[10px] tabular-nums"
                >
                  {formatCompactNumber(tick, locale)}
                </text>
              </g>
            )
          })}

          {hover ? (
            <rect
              className="viz-hover-band"
              x={LEFT_PAD + slot * hover.hour}
              y={TOP_PAD}
              width={Math.max(0, slot)}
              height={PLOT_HEIGHT}
              fill="var(--muted)"
            />
          ) : null}

          {hourly.map((value, hour) => {
            const height = baselineY - yFor(value)
            const x = LEFT_PAD + slot * hour + (slot - barWidth) / 2
            const isMax = value === maxValue && value > 0
            return (
              <g key={`hour-bar-${hour}`} style={{ '--viz-index': hour } as CSSProperties}>
                {height > 0 ? (
                  <path
                    className="viz-bar viz-bar-grow"
                    d={buildBarPath(x, baselineY - height, barWidth, height, 4)}
                    fill="var(--viz-series-1)"
                  />
                ) : null}
                {isMax ? (
                  <text
                    x={x + barWidth / 2}
                    y={baselineY - height - 4}
                    textAnchor="middle"
                    className="fill-muted-foreground text-[10px] tabular-nums"
                  >
                    {formatCompactNumber(value, locale)}
                  </text>
                ) : null}
              </g>
            )
          })}

          {/* 每 3 小时一个标签 */}
          {Array.from({ length: 24 }, (_, hour) => hour).map((hour) =>
            hour % 3 === 0 ? (
              <text
                key={`hour-label-${hour}`}
                x={centerFor(hour)}
                y={baselineY + 15}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px] tabular-nums"
              >
                {`${padHour(hour)}:00`}
              </text>
            ) : null
          )}
        </svg>
      )}

      {hover ? (
        <ChartTooltip
          title={t('hourly.tooltipRange', {
            start: `${padHour(hover.hour)}:00`,
            end: `${padHour(hover.hour + 1)}:00`,
            count: formatCompactNumber(hoveredValue, locale),
          })}
          rows={[]}
          x={hover.x}
          y={hover.y}
          containerWidth={safeWidth}
          estimatedWidth={132}
        />
      ) : null}
    </div>
  )
}
