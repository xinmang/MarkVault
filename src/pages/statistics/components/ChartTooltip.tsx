import type { CSSProperties, ReactNode } from 'react'

export interface TooltipRow {
  key: string
  label: string
  value: string
  /** 行首色块的颜色（CSS 颜色或 var(...)）；省略则不画色块 */
  swatch?: string
}

interface ChartTooltipProps {
  title: string
  rows: TooltipRow[]
  /** 合计行；只在可见序列为 2 时传入 */
  total?: { label: string; value: string }
  /** 相对定位容器（即卡片）的像素坐标 */
  x: number
  y: number
  /** 卡片宽度，用于把 tooltip 夹在卡片内部 */
  containerWidth: number
  /** 估算宽度，用于水平夹逼 */
  estimatedWidth?: number
  className?: string
}

const GAP = 10
const EDGE = 8

/**
 * 图表共用的浮动 tooltip。
 * 外层负责把锚点夹在卡片内部，内层负责入场动画，避免两者互相覆盖 transform。
 */
export function ChartTooltip({
  title,
  rows,
  total,
  x,
  y,
  containerWidth,
  estimatedWidth = 168,
  className = '',
}: ChartTooltipProps) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null

  const halfWidth = Math.min(estimatedWidth, Math.max(0, containerWidth - EDGE * 2)) / 2
  const minX = halfWidth + EDGE
  const maxX = Math.max(minX, containerWidth - halfWidth - EDGE)
  const clampedX = Math.min(maxX, Math.max(minX, x))
  // 锚点太靠上时翻到锚点下方，仍然留在卡片内部
  const flip = y - GAP < 60

  const wrapperStyle: CSSProperties = {
    left: clampedX,
    top: y,
    transform: flip ? `translate(-50%, ${GAP + 10}px)` : `translate(-50%, calc(-100% - ${GAP}px))`,
  }

  return (
    <div
      className="pointer-events-none absolute z-20"
      style={wrapperStyle}
      role="presentation"
      aria-hidden="true"
    >
      <div
        className={`viz-tooltip min-w-[132px] max-w-[240px] rounded-[9px] border border-border bg-popover px-2.5 py-2 text-[11.5px] leading-[1.5] text-popover-foreground shadow-lg ${className}`}
      >
        <div className="mb-1 font-semibold text-foreground">{title}</div>
        {rows.map((row) => (
          <div key={row.key} className="flex items-center gap-1.5">
            {row.swatch ? (
              <span
                aria-hidden="true"
                className="h-[7px] w-[7px] shrink-0 rounded-[2px]"
                style={{ backgroundColor: row.swatch }}
              />
            ) : null}
            <span className="truncate text-muted-foreground">{row.label}</span>
            <span className="ml-auto pl-3 font-semibold tabular-nums text-foreground">
              {row.value}
            </span>
          </div>
        ))}
        {total ? (
          <div className="mt-1 flex items-center gap-1.5 border-t border-border pt-1">
            <span className="text-muted-foreground">{total.label}</span>
            <span className="ml-auto pl-3 font-semibold tabular-nums text-foreground">
              {total.value}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** 小尺寸色块，供图例 / 排行复用 */
export function SeriesSwatch({
  color,
  className = '',
}: {
  color: string
  className?: string
}): ReactNode {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 rounded-[2px] ${className || 'h-[7px] w-[7px]'}`}
      style={{ backgroundColor: color }}
    />
  )
}
