/**
 * 无限画布的纯计算：视口换算、缩放、适应内容、卡片排布与位置存取。
 * 不依赖 DOM，画布组件和测试共用。
 *
 * 坐标约定：世界坐标是卡片排布用的坐标，屏幕坐标以画布左上角为原点，
 * 两者的关系是 屏幕 = 世界 × scale + (x, y)。
 */

export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface Rect extends Point, Size {}

export interface Viewport extends Point {
  scale: number
}

export const MIN_SCALE = 0.1
export const MAX_SCALE = 2.5
/** 初次进入画布时的视口：原始大小，内容左上角留出一点边距。 */
export const INITIAL_VIEWPORT: Viewport = { x: 24, y: 24, scale: 1 }

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

/** 以屏幕上的一点为中心缩放到指定倍率，该点下方的内容保持不动。 */
export function zoomAt(viewport: Viewport, point: Point, scale: number): Viewport {
  const next = clampScale(scale)
  const ratio = next / viewport.scale
  return {
    scale: next,
    x: point.x - (point.x - viewport.x) * ratio,
    y: point.y - (point.y - viewport.y) * ratio,
  }
}

/**
 * 滚轮一次滚动对应的缩放倍数。触控板捏合每次只给很小的位移，鼠标滚轮一格约 100，
 * 位移封顶后两者的手感都不至于太猛。deltaMode 为 1 时单位是行。
 */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaY
  return Math.exp(-Math.min(60, Math.max(-60, pixels)) * 0.004)
}

export function toWorld(viewport: Viewport, point: Point): Point {
  return { x: (point.x - viewport.x) / viewport.scale, y: (point.y - viewport.y) / viewport.scale }
}

/** 画布当前露出的世界范围。 */
export function visibleWorld(viewport: Viewport, container: Size): Rect {
  const origin = toWorld(viewport, { x: 0, y: 0 })
  return {
    ...origin,
    width: container.width / viewport.scale,
    height: container.height / viewport.scale,
  }
}

/** 一组矩形的外接矩形；没有矩形时返回 null。 */
export function boundsOf(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const rect of rects) {
    left = Math.min(left, rect.x)
    top = Math.min(top, rect.y)
    right = Math.max(right, rect.x + rect.width)
    bottom = Math.max(bottom, rect.y + rect.height)
  }
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * 把内容整体放进画布并居中。内容比画布小时不放大超过 maxScale，
 * 避免只有一两张卡片时被放得过大。
 */
export function fitViewport(
  bounds: Rect | null,
  container: Size,
  padding = 48,
  maxScale = 1
): Viewport {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return INITIAL_VIEWPORT
  if (container.width <= 0 || container.height <= 0) return INITIAL_VIEWPORT
  const room = {
    width: Math.max(1, container.width - padding * 2),
    height: Math.max(1, container.height - padding * 2),
  }
  const scale = clampScale(
    Math.min(maxScale, room.width / bounds.width, room.height / bounds.height)
  )
  return {
    scale,
    x: (container.width - bounds.width * scale) / 2 - bounds.x * scale,
    y: (container.height - bounds.height * scale) / 2 - bounds.y * scale,
  }
}

/** 保持倍率不变，把世界里的一点移到画布中央。 */
export function centerOn(viewport: Viewport, world: Point, container: Size): Viewport {
  return {
    scale: viewport.scale,
    x: container.width / 2 - world.x * viewport.scale,
    y: container.height / 2 - world.y * viewport.scale,
  }
}

/**
 * 背景网格在屏幕上的间距。缩得很小时把间距成倍放大，
 * 网点不会密成一片灰。
 */
export function gridStep(scale: number, base = 24): number {
  let step = base * clampScale(scale)
  while (step < 16) step *= 2
  return step
}

export interface PackItem {
  id: string
  height: number
  /** 占几列，默认 1 */
  span?: number
}

export interface PackOptions {
  columnWidth: number
  gap: number
  /** 列数；不传时按内容总面积和目标宽高比估算 */
  columns?: number
  /** 自动估算列数时整幅画布的目标宽高比（宽 / 高） */
  aspect?: number
  /** 已被手动摆放的卡片，自动排布的卡片会避开它们 */
  obstacles?: readonly Rect[]
}

/**
 * 画布不受屏幕宽度限制，列数按内容多少决定：内容越多画布越宽，
 * 整体保持接近屏幕的横向比例，缩小后能一眼看全。
 */
export function columnsFor(
  items: readonly PackItem[],
  { columnWidth, gap, aspect = 1.6 }: PackOptions
): number {
  let area = 0
  let widest = 1
  for (const item of items) {
    const span = Math.max(1, Math.floor(item.span ?? 1))
    widest = Math.max(widest, span)
    area += span * (columnWidth + gap) * (Math.max(0, item.height) + gap)
  }
  if (area <= 0) return widest
  return Math.max(widest, Math.round(Math.sqrt(area * aspect) / (columnWidth + gap)))
}

function intersects(a: Rect, b: Rect, gap: number): boolean {
  return (
    a.x < b.x + b.width + gap &&
    b.x < a.x + a.width + gap &&
    a.y < b.y + b.height + gap &&
    b.y < a.y + a.height + gap
  )
}

/**
 * 瀑布流排布：按顺序把每张卡片放进当前最短的位置，跨多列的卡片找一段最矮的连续列。
 * 遇到手动摆放的卡片时往下让开。返回每张卡片的位置与尺寸。
 */
export function packNodes(items: readonly PackItem[], options: PackOptions): Record<string, Rect> {
  const { columnWidth, gap, obstacles = [] } = options
  const columns = Math.max(1, Math.floor(options.columns ?? columnsFor(items, options)))
  const heights = Array.from({ length: columns }, () => 0)
  const result: Record<string, Rect> = {}
  for (const item of items) {
    const span = Math.min(columns, Math.max(1, Math.floor(item.span ?? 1)))
    let column = 0
    let top = Infinity
    for (let start = 0; start + span <= columns; start++) {
      const candidate = Math.max(...heights.slice(start, start + span))
      if (candidate < top) {
        top = candidate
        column = start
      }
    }
    const rect: Rect = {
      x: column * (columnWidth + gap),
      y: top,
      width: span * columnWidth + (span - 1) * gap,
      height: Math.max(0, item.height),
    }
    // 每让开一张卡片 y 只会增大，最多把全部障碍各让一次
    for (let pass = 0; pass <= obstacles.length; pass++) {
      const blocker = obstacles.find((obstacle) => intersects(rect, obstacle, gap))
      if (!blocker) break
      rect.y = blocker.y + blocker.height + gap
    }
    for (let index = column; index < column + span; index++)
      heights[index] = rect.y + rect.height + gap
    result[item.id] = rect
  }
  return result
}

/** 保存在浏览器里的画布状态：视口，以及手动摆放过的卡片位置。 */
export interface CanvasState {
  viewport: Viewport | null
  positions: Record<string, Point>
}

export const EMPTY_CANVAS_STATE: CanvasState = { viewport: null, positions: {} }

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/** 解析保存的画布状态；内容损坏或字段不对时忽略对应部分。 */
export function parseCanvasState(raw: string | null | undefined): CanvasState {
  if (!raw) return EMPTY_CANVAS_STATE
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return EMPTY_CANVAS_STATE
  }
  if (!data || typeof data !== 'object') return EMPTY_CANVAS_STATE
  const { v, p } = data as { v?: unknown; p?: unknown }
  let viewport: Viewport | null = null
  if (Array.isArray(v) && finite(v[0]) && finite(v[1]) && finite(v[2]))
    viewport = { x: v[0], y: v[1], scale: clampScale(v[2]) }
  const positions: Record<string, Point> = {}
  if (p && typeof p === 'object' && !Array.isArray(p))
    for (const [id, value] of Object.entries(p))
      if (Array.isArray(value) && finite(value[0]) && finite(value[1]))
        positions[id] = { x: value[0], y: value[1] }
  return { viewport, positions }
}

export function serializeCanvasState(state: CanvasState): string {
  const round = (value: number) => Math.round(value * 100) / 100
  return JSON.stringify({
    v: state.viewport
      ? [round(state.viewport.x), round(state.viewport.y), round(state.viewport.scale)]
      : undefined,
    p: Object.fromEntries(
      Object.entries(state.positions).map(([id, point]) => [id, [round(point.x), round(point.y)]])
    ),
  })
}
