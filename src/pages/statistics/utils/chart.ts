/** 坐标点 */
export interface Point {
  x: number
  y: number
}

/**
 * 生成“干净”的 y 轴刻度（含 0），步长取 1/2/5 × 10^k。
 * 例如 max=9 -> [0, 2, 4, 6, 8, 10]；max=1234 -> [0, 500, 1000, 1500]
 */
export function niceTicks(maxValue: number, targetCount = 4): number[] {
  const safeMax = Number.isFinite(maxValue) && maxValue > 0 ? maxValue : 0
  const safeTarget = Math.max(1, Math.floor(targetCount))
  if (safeMax === 0) return [0, 1]

  const roughStep = safeMax / safeTarget
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)))
  const normalized = roughStep / magnitude
  // 经典的 1/2/5/10 取整：阈值放在 1.5 / 3 / 7，避免 2.25 这类
  // 略大于 2 的步长被抬到 5（否则 max=9 只剩 3 条刻度）
  const niceNormalized = normalized <= 1.5 ? 1 : normalized <= 3 ? 2 : normalized <= 7 ? 5 : 10
  const step = Math.max(1, niceNormalized * magnitude)
  const top = Math.ceil(safeMax / step) * step

  const ticks: number[] = []
  for (let value = 0; value <= top + step / 2; value += step) {
    ticks.push(Math.round(value * 1000) / 1000)
  }
  return ticks
}

/**
 * 依据可用宽度挑选 x 轴标签下标，保证标签间距不小于 minSpacing。
 * 返回的数组始终包含首尾附近的桶，数量控制在约 6–8 个。
 */
export function pickLabelIndices(count: number, availableWidth: number, minSpacing = 56): number[] {
  if (count <= 0) return []
  if (count === 1) return [0]
  const safeWidth = Number.isFinite(availableWidth) ? Math.max(0, availableWidth) : 0
  const maxLabels = Math.max(2, Math.floor(safeWidth / Math.max(1, minSpacing)) || 0)
  if (maxLabels >= count) {
    return Array.from({ length: count }, (_, index) => index)
  }
  const stride = Math.max(1, Math.ceil((count - 1) / Math.max(1, maxLabels - 1)))
  const indices: number[] = []
  for (let index = 0; index < count; index += stride) indices.push(index)
  const last = count - 1
  if (indices[indices.length - 1] !== last) {
    // 末尾不足一个步长时去掉倒数第二个标签，保证任意相邻标签间距都不小于步长
    const previous = indices[indices.length - 1]
    if (previous !== undefined && previous !== 0 && last - previous < stride) indices.pop()
    indices.push(last)
  }
  return indices
}

/** 折线路径（直线段，圆角由 stroke-linejoin 提供） */
export function buildLinePath(points: Point[]): string {
  if (points.length === 0) return ''
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${round(point.x)} ${round(point.y)}`)
    .join(' ')
}

/** 面积路径：折线 + 回到基线闭合 */
export function buildAreaPath(points: Point[], baselineY: number): string {
  if (points.length === 0) return ''
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last) return ''
  return `${buildLinePath(points)} L${round(last.x)} ${round(baselineY)} L${round(first.x)} ${round(baselineY)} Z`
}

/**
 * 比例尺上界：取 niceTicks 的最大刻度，至少为 1，避免后续除零。
 * 与 niceTicks 共用同一套步长，保证网格线与刻度一致。
 */
export function scaleMaxFor(maxValue: number, targetCount = 4): number {
  const ticks = niceTicks(maxValue, targetCount)
  const top = ticks[ticks.length - 1]
  return typeof top === 'number' && top > 0 ? top : 1
}

/** 数值夹逼，NaN / 非有限值回退到下限 */
export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

/**
 * 柱形槽位：每个桶一个槽，柱宽不超过上限，也永远不填满整个槽位。
 */
export function barSlotGeometry(
  plotWidth: number,
  count: number,
  maxBarWidth = 24,
  fillRatio = 0.62
): { slot: number; barWidth: number } {
  if (count <= 0 || !Number.isFinite(plotWidth) || plotWidth <= 0) {
    return { slot: 0, barWidth: 0 }
  }
  const slot = plotWidth / count
  const barWidth = Math.max(1, Math.min(maxBarWidth, slot * fillRatio))
  return { slot, barWidth }
}

/** 柱形路径：顶部圆角、底部直角 */
export function buildBarPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius = 4
): string {
  const safeWidth = Math.max(0, width)
  const safeHeight = Math.max(0, height)
  const r = Math.min(radius, safeWidth / 2, safeHeight)
  if (safeHeight <= 0) return ''
  const bottom = y + safeHeight
  return [
    `M${round(x)} ${round(bottom)}`,
    `L${round(x)} ${round(y + r)}`,
    `Q${round(x)} ${round(y)} ${round(x + r)} ${round(y)}`,
    `L${round(x + safeWidth - r)} ${round(y)}`,
    `Q${round(x + safeWidth)} ${round(y)} ${round(x + safeWidth)} ${round(y + r)}`,
    `L${round(x + safeWidth)} ${round(bottom)}`,
    'Z',
  ].join(' ')
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
