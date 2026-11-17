import { useMemo, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { formatCompactNumber, padHour } from '../utils/format'
import { HEATMAP_CLASSES, heatmapLevel, heatmapMax, toMondayFirstHeatmap } from '../utils/heatmap'
import { ChartTooltip } from './ChartTooltip'
import { EmptyState } from './EmptyState'

interface HeatmapCardProps {
  /** 服务端原始 heatmap（0=周日），可能不是 7×24 */
  heatmap: number[][]
  locale: string
  /** 嵌入趋势卡左列时去掉卡片外框，用一根发丝线与上方图表分隔 */
  embedded?: boolean
}

/** 周一优先的星期键，顺序即显示顺序 */
const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

interface HoverState {
  row: number
  col: number
  /** 相对卡片左上角的锚点 */
  x: number
  y: number
}

/**
 * 访问时段分布：7 行（周一 -> 周日）× 24 列，单色相 5 级色阶。
 * 每个单元格都有 aria-label，悬停与键盘聚焦时显示同一个 tooltip。
 */
export function HeatmapCard({ heatmap, locale, embedded = false }: HeatmapCardProps) {
  const { t } = useTranslation('statistics')
  const sectionRef = useRef<HTMLElement | null>(null)
  const [hover, setHover] = useState<HoverState | null>(null)
  const [width, setWidth] = useState(0)

  const rows = useMemo(() => toMondayFirstHeatmap(heatmap), [heatmap])
  const max = useMemo(() => heatmapMax(rows), [rows])

  const weekdayLabels = WEEKDAY_KEYS.map((key) => t(`heatmap.weekday.${key}`))

  const cellLabel = (row: number, col: number): string =>
    t('heatmap.cellLabel', {
      weekday: weekdayLabels[row] ?? '',
      start: `${padHour(col)}:00`,
      end: `${padHour(col + 1)}:00`,
      count: rows[row]?.[col] ?? 0,
    })

  const showAt = (element: HTMLElement, row: number, col: number) => {
    const section = sectionRef.current
    if (!section) return
    const rect = section.getBoundingClientRect()
    const target = element.getBoundingClientRect()
    setWidth(rect.width)
    setHover({
      row,
      col,
      x: target.left - rect.left + target.width / 2,
      y: target.top - rect.top,
    })
  }

  return (
    <figure
      ref={sectionRef}
      aria-label={t('heatmap.title')}
      className={
        embedded
          ? 'relative m-0 mt-3 overflow-hidden border-t border-border pt-3'
          : 'relative m-0 overflow-hidden rounded-xl border border-border bg-card px-[14px] py-[10px]'
      }
    >
      <figcaption className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-[12px] font-medium text-foreground">{t('heatmap.title')}</h2>
        <span className="truncate text-[10.5px] text-muted-foreground">
          {t('heatmap.description')}
        </span>
      </figcaption>

      {max <= 0 ? (
        <EmptyState message={t('heatmap.empty')} />
      ) : (
        <>
          <div className="viz-heat-scroll">
            <div className="viz-heat-grid" role="grid" aria-label={t('heatmap.title')}>
              {/* 表头：小时，每 3 小时一个标签 */}
              <span aria-hidden="true" />
              {Array.from({ length: 24 }, (_, hour) => hour).map((hour) => (
                <span
                  key={`heat-hour-${hour}`}
                  aria-hidden="true"
                  className="pb-0.5 text-center text-[9.5px] tabular-nums text-muted-foreground"
                >
                  {hour % 3 === 0 ? padHour(hour) : ''}
                </span>
              ))}

              {rows.map((cells, rowIndex) => (
                <HeatmapRow
                  key={`heat-row-${rowIndex}`}
                  rowIndex={rowIndex}
                  cells={cells}
                  max={max}
                  weekdayLabel={weekdayLabels[rowIndex] ?? ''}
                  cellLabel={cellLabel}
                  onShow={showAt}
                  onHide={() => setHover(null)}
                  activeCol={hover?.row === rowIndex ? hover.col : null}
                />
              ))}
            </div>
          </div>

          <div className="mt-2 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
            <span>{t('heatmap.less')}</span>
            {Array.from({ length: HEATMAP_CLASSES }, (_, index) => (
              <span
                key={`heat-legend-${index}`}
                aria-hidden="true"
                className="h-2.5 w-2.5 rounded-[2px]"
                style={{ backgroundColor: `var(--viz-heat-${index + 1})` }}
              />
            ))}
            <span>{t('heatmap.more')}</span>
            <span className="ml-auto tabular-nums">{formatCompactNumber(max, locale)}</span>
          </div>
        </>
      )}

      {hover ? (
        <ChartTooltip
          title={cellLabel(hover.row, hover.col)}
          rows={[]}
          x={hover.x}
          y={hover.y}
          containerWidth={width}
          estimatedWidth={170}
        />
      ) : null}
    </figure>
  )
}

interface HeatmapRowProps {
  rowIndex: number
  cells: number[]
  max: number
  weekdayLabel: string
  cellLabel: (row: number, col: number) => string
  onShow: (element: HTMLElement, row: number, col: number) => void
  onHide: () => void
  activeCol: number | null
}

function HeatmapRow({
  rowIndex,
  cells,
  max,
  weekdayLabel,
  cellLabel,
  onShow,
  onHide,
  activeCol,
}: HeatmapRowProps) {
  return (
    <>
      <span className="pr-1 text-right text-[10px] leading-[15px] text-muted-foreground">
        {weekdayLabel}
      </span>
      {Array.from({ length: 24 }, (_, col) => col).map((col) => {
        const value = cells[col] ?? 0
        const level = heatmapLevel(value, max)
        const style: CSSProperties = {
          backgroundColor: level === 0 ? 'var(--muted)' : `var(--viz-heat-${level})`,
        }
        return (
          <button
            key={`heat-${rowIndex}-${col}`}
            type="button"
            role="gridcell"
            aria-label={cellLabel(rowIndex, col)}
            title={cellLabel(rowIndex, col)}
            style={style}
            onPointerEnter={(event) => onShow(event.currentTarget, rowIndex, col)}
            onPointerLeave={onHide}
            onFocus={(event) => onShow(event.currentTarget, rowIndex, col)}
            onBlur={onHide}
            className={`viz-heat-cell block h-[15px] w-full rounded-[2px] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring ${
              activeCol === col ? 'ring-1 ring-foreground/40' : ''
            }`}
          />
        )
      })}
    </>
  )
}
