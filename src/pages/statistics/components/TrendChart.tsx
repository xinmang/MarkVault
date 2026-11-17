import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { AnalyticsResponse, AnalyticsTrendPoint } from '@/lib/types'
import { useElementWidth } from '../hooks/useElementWidth'
import {
  barSlotGeometry,
  buildAreaPath,
  buildBarPath,
  buildLinePath,
  niceTicks,
  pickLabelIndices,
  scaleMaxFor,
  type Point,
} from '../utils/chart'
import { formatBucketFullLabel, formatBucketLabel, formatCompactNumber } from '../utils/format'
import { pickPeakBucket, type ChartStyle, type SeriesSelection } from '../utils/view'
import { ChartTooltip } from './ChartTooltip'
import { EmptyState } from './EmptyState'

/** 绘图区高度（不含 x 轴标签带） */
const PLOT_HEIGHT = 236
const AXIS_BAND = 22
const TOP_PAD = 14
const LEFT_PAD = 34
const RIGHT_PAD = 8
const BAR_GAP = 2

interface TrendChartProps {
  data: AnalyticsResponse
  locale: string
  chartStyle: ChartStyle
  series: SeriesSelection
  onDrillDown: (start: string, end: string) => void
}

interface HoverState {
  index: number
  /** 相对卡片左上角的像素坐标 */
  x: number
  y: number
}

interface SeriesMeta {
  key: 'bookmark' | 'tag'
  label: string
  color: string
  value: (point: AnalyticsTrendPoint) => number
}

/**
 * 趋势绘图区：柱状（默认，两序列堆叠）与折线两种样式共用同一套刻度、
 * 悬停带、tooltip 与键盘交互。
 */
export function TrendChart({ data, locale, chartStyle, series, onDrillDown }: TrendChartProps) {
  const { t } = useTranslation('statistics')
  const { ref, width } = useElementWidth<HTMLDivElement>()
  const [hover, setHover] = useState<HoverState | null>(null)
  const activeIndexRef = useRef<number>(-1)
  const plotId = useId()

  const points = data.trend
  const granularity = data.range.granularity
  const tagsAvailable = data.tags_available && !data.filters.bookmark

  const showBookmark = series !== 'tag'
  const showTag = tagsAvailable && series !== 'bookmark'

  const seriesList = useMemo<SeriesMeta[]>(() => {
    const list: SeriesMeta[] = []
    if (showBookmark) {
      list.push({
        key: 'bookmark',
        label: t('trend.seriesBookmark'),
        color: 'var(--viz-series-1)',
        value: (point) => point.bookmark_clicks,
      })
    }
    if (showTag) {
      list.push({
        key: 'tag',
        label: t('trend.seriesTag'),
        color: 'var(--viz-series-2)',
        value: (point) => point.tag_clicks,
      })
    }
    return list
  }, [showBookmark, showTag, t])

  // 柱状模式两序列堆叠，刻度要容纳每列的合计；折线模式取单条序列的最大值
  const maxValue = useMemo(() => {
    let max = 0
    for (const point of points) {
      let stacked = 0
      for (const meta of seriesList) {
        const value = meta.value(point)
        if (!Number.isFinite(value) || value <= 0) continue
        stacked += value
        if (value > max) max = value
      }
      if (chartStyle === 'bar' && stacked > max) max = stacked
    }
    return max
  }, [chartStyle, points, seriesList])

  const ticks = useMemo(() => niceTicks(maxValue, 4), [maxValue])
  const scaleMax = useMemo(() => scaleMaxFor(maxValue, 4), [maxValue])

  const overallPeak = useMemo(() => pickPeakBucket(points, true, true), [points])

  const hasData = points.length > 0 && maxValue > 0
  const safeWidth = Math.max(0, width)
  const plotWidth = Math.max(0, safeWidth - LEFT_PAD - RIGHT_PAD)
  const baselineY = TOP_PAD + PLOT_HEIGHT
  const count = points.length

  const xFor = useCallback(
    (index: number): number => {
      if (count <= 1) return LEFT_PAD + plotWidth / 2
      return LEFT_PAD + (plotWidth / (count - 1)) * index
    },
    [count, plotWidth]
  )

  /** 柱状模式下每列的中心点；折线模式用等距点 */
  const slotGeometry = useMemo(
    () => barSlotGeometry(plotWidth, count, 24, 0.62),
    [plotWidth, count]
  )

  const barCenter = useCallback(
    (index: number): number => {
      const slot = slotGeometry.slot
      return LEFT_PAD + slot * index + slot / 2
    },
    [slotGeometry.slot]
  )

  const centerFor = chartStyle === 'bar' ? barCenter : xFor

  const yFor = useCallback(
    (value: number): number => {
      const safe = Number.isFinite(value) && value > 0 ? value : 0
      return baselineY - (safe / scaleMax) * PLOT_HEIGHT
    },
    [baselineY, scaleMax]
  )

  const linePoints = useMemo(() => {
    const map = new Map<string, Point[]>()
    for (const meta of seriesList) {
      map.set(
        meta.key,
        points.map((point, index) => ({ x: xFor(index), y: yFor(meta.value(point)) }))
      )
    }
    return map
  }, [points, seriesList, xFor, yFor])

  const labelIndices = useMemo(
    () => pickLabelIndices(count, Math.max(0, plotWidth), 64),
    [count, plotWidth]
  )

  const nearestIndex = useCallback(
    (localX: number): number => {
      if (count <= 0) return -1
      if (chartStyle === 'bar' && slotGeometry.slot > 0) {
        const raw = Math.floor((localX - LEFT_PAD) / slotGeometry.slot)
        return Math.min(count - 1, Math.max(0, raw))
      }
      if (count === 1 || plotWidth <= 0) return 0
      const ratio = (localX - LEFT_PAD) / plotWidth
      return Math.min(count - 1, Math.max(0, Math.round(ratio * (count - 1))))
    },
    [chartStyle, count, plotWidth, slotGeometry.slot]
  )

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!hasData) return
    const rect = event.currentTarget.getBoundingClientRect()
    const index = nearestIndex(event.clientX - rect.left)
    if (index < 0) return
    activeIndexRef.current = index
    setHover({
      index,
      x: centerFor(index),
      y: event.clientY - rect.top,
    })
  }

  const clearHover = () => {
    activeIndexRef.current = -1
    setHover(null)
  }

  const drill = useCallback(
    (index: number) => {
      const point = points[index]
      if (!point) return
      onDrillDown(point.start_date, point.end_date)
    },
    [onDrillDown, points]
  )

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!hasData) return
    const current = hover ? hover.index : activeIndexRef.current
    const fallback = current >= 0 ? current : count - 1

    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      const delta = event.key === 'ArrowRight' ? 1 : -1
      const next = Math.min(count - 1, Math.max(0, fallback + delta))
      activeIndexRef.current = next
      setHover({ index: next, x: centerFor(next), y: baselineY })
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      if (current < 0) return
      event.preventDefault()
      drill(current)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      clearHover()
    }
  }

  const hoveredPoint = hover ? points[hover.index] : undefined
  const hoveredBandX =
    hover && chartStyle === 'bar' && slotGeometry.slot > 0
      ? LEFT_PAD + slotGeometry.slot * hover.index
      : hover
        ? Math.max(LEFT_PAD, centerFor(hover.index) - slotGeometry.slot / 2)
        : 0
  const hoveredBandWidth =
    chartStyle === 'bar' && slotGeometry.slot > 0
      ? slotGeometry.slot
      : Math.max(8, plotWidth / Math.max(1, count - 1))

  const tooltipRows = hoveredPoint
    ? seriesList.map((meta) => ({
        key: meta.key,
        label: meta.label,
        value: formatCompactNumber(meta.value(hoveredPoint), locale),
        swatch: meta.color,
      }))
    : []

  const tooltipTotal =
    hoveredPoint && seriesList.length === 2
      ? {
          label: t('trend.total'),
          value: formatCompactNumber(
            seriesList.reduce((sum, meta) => sum + meta.value(hoveredPoint), 0),
            locale
          ),
        }
      : undefined

  // 峰值说明固定按「合计点击数」取，切换序列时只改说明，不改数据
  const peakCaption = overallPeak
    ? t('trend.peakCaption', {
        count: formatCompactNumber(overallPeak.value, locale),
        label: formatBucketLabel(overallPeak.point.bucket, granularity, locale),
      })
    : ''

  return (
    <div className="relative">
      <div className="flex h-4 items-center justify-end">
        {peakCaption ? (
          <span className="truncate text-[10.5px] tabular-nums text-muted-foreground">
            {peakCaption}
          </span>
        ) : null}
      </div>

      <div
        ref={ref}
        className="viz-plot"
        style={{ height: PLOT_HEIGHT + TOP_PAD + AXIS_BAND }}
        tabIndex={hasData ? 0 : -1}
        role="group"
        aria-label={t('trend.title')}
        aria-describedby={`${plotId}-hint`}
        onPointerMove={handlePointerMove}
        onPointerLeave={clearHover}
        onBlur={clearHover}
        onKeyDown={handleKeyDown}
        onClick={(event) => {
          // 触屏可能没有先触发 pointermove，这里按点击位置补算一次
          const rect = event.currentTarget.getBoundingClientRect()
          const index = nearestIndex(event.clientX - rect.left)
          if (index >= 0) drill(index)
        }}
      >
        {!hasData ? (
          <EmptyState message={t('trend.empty')} compact />
        ) : (
          <svg
            width={safeWidth || 1}
            height={PLOT_HEIGHT + TOP_PAD + AXIS_BAND}
            role="img"
            aria-hidden="true"
            className="block overflow-visible"
          >
            {/* 网格线：实线发丝，永远不用虚线 */}
            {ticks.map((tick) => {
              const y = yFor(tick)
              return (
                <g key={`tick-${tick}`}>
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

            {/* 悬停背景带：整列高度，位于图形标记之下 */}
            {hover && hoveredPoint ? (
              <rect
                className="viz-hover-band"
                x={hoveredBandX}
                y={TOP_PAD}
                width={Math.max(0, hoveredBandWidth)}
                height={PLOT_HEIGHT}
                fill="var(--muted)"
                aria-hidden="true"
              />
            ) : null}

            {chartStyle === 'bar'
              ? points.map((point, index) => {
                  const slot = slotGeometry.slot
                  const barWidth = Math.max(1, slotGeometry.barWidth)
                  const x = LEFT_PAD + slot * index + (slot - barWidth) / 2
                  const bookmarkHeight = showBookmark ? baselineY - yFor(point.bookmark_clicks) : 0
                  const tagHeight = showTag ? baselineY - yFor(point.tag_clicks) : 0
                  // 书签段贴着基线，标签段堆在上面；两段都有高度时留 2px 卡片色缝隙
                  const bookmarkY = baselineY - bookmarkHeight
                  const gap = bookmarkHeight > 0 && tagHeight > 0 ? BAR_GAP : 0
                  const tagY = bookmarkY - tagHeight - gap

                  return (
                    <g key={point.bucket} style={{ '--viz-index': index } as CSSProperties}>
                      {bookmarkHeight > 0 ? (
                        <path
                          className="viz-bar viz-bar-grow"
                          d={buildBarPath(x, bookmarkY, barWidth, bookmarkHeight, 3)}
                          fill="var(--viz-series-1)"
                        />
                      ) : null}
                      {tagHeight > 0 ? (
                        <path
                          className="viz-bar viz-bar-grow"
                          d={buildBarPath(x, tagY, barWidth, tagHeight, 3)}
                          fill="var(--viz-series-2)"
                        />
                      ) : null}
                    </g>
                  )
                })
              : null}

            {chartStyle === 'line' ? (
              <>
                {/* 面积淡色只跟随书签序列，标签单独显示时不画 */}
                {showBookmark ? (
                  <path
                    className="viz-series-area"
                    d={buildAreaPath(linePoints.get('bookmark') ?? [], baselineY)}
                    fill="var(--viz-series-1-wash)"
                  />
                ) : null}
                {seriesList.map((meta) => {
                  const points2 = linePoints.get(meta.key)
                  if (!points2 || points2.length === 0) return null
                  return (
                    <path
                      key={meta.key}
                      className="viz-series-line"
                      d={buildLinePath(points2)}
                      fill="none"
                      stroke={meta.color}
                      strokeWidth={2}
                    />
                  )
                })}
              </>
            ) : null}

            {/* 折线模式：悬停点画圆点（半径 >= 4，2px 卡片色描边） */}
            {chartStyle === 'line' && hoveredPoint
              ? seriesList.map((meta) => {
                  const x = xFor(hover?.index ?? 0)
                  const y = yFor(meta.value(hoveredPoint))
                  return (
                    <circle
                      key={`dot-${meta.key}`}
                      cx={x}
                      cy={y}
                      r={4}
                      fill={meta.color}
                      stroke="var(--card)"
                      strokeWidth={2}
                    />
                  )
                })
              : null}

            {/* x 轴标签：按可用宽度抽稀，避免重叠 */}
            {labelIndices.map((index) => {
              const point = points[index]
              if (!point) return null
              const x = centerFor(index)
              return (
                <text
                  key={`label-${point.bucket}`}
                  x={x}
                  y={baselineY + 15}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[10px]"
                >
                  {formatBucketLabel(point.bucket, granularity, locale)}
                </text>
              )
            })}
          </svg>
        )}

        {hover && hoveredPoint ? (
          <ChartTooltip
            title={formatBucketFullLabel(hoveredPoint.bucket, granularity, locale)}
            rows={tooltipRows}
            total={tooltipTotal}
            x={hover.x}
            y={hover.y}
            containerWidth={safeWidth}
          />
        ) : null}
      </div>

      <p id={`${plotId}-hint`} className="sr-only">
        {t('trend.keyboardHint')}
      </p>
    </div>
  )
}
