/** 热力图固定为 7 行 × 24 列 */
export const HEATMAP_ROWS = 7
export const HEATMAP_COLS = 24
export const HEATMAP_CLASSES = 5

/**
 * 把服务端返回的 heatmap（可能缺行/缺列）补齐为 7×24。
 * 行索引保持服务端语义：0 = 周日 … 6 = 周六。
 */
export function normalizeHeatmap(raw: number[][] | null | undefined): number[][] {
  const result: number[][] = []
  for (let row = 0; row < HEATMAP_ROWS; row++) {
    const sourceRow = Array.isArray(raw) ? raw[row] : undefined
    const cells: number[] = []
    for (let col = 0; col < HEATMAP_COLS; col++) {
      const value = Array.isArray(sourceRow) ? sourceRow[col] : undefined
      cells.push(typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0)
    }
    result.push(cells)
  }
  return result
}

/** 服务端 weekday（0=周日）-> 周一优先的显示行下标（0=周一 … 6=周日） */
export function weekdayToRowIndex(weekday: number): number {
  const normalized = ((Math.round(weekday) % HEATMAP_ROWS) + HEATMAP_ROWS) % HEATMAP_ROWS
  return (normalized + 6) % 7
}

/** 显示行下标（0=周一）-> 服务端 weekday（0=周日） */
export function rowIndexToWeekday(rowIndex: number): number {
  const normalized = ((Math.round(rowIndex) % HEATMAP_ROWS) + HEATMAP_ROWS) % HEATMAP_ROWS
  return (normalized + 1) % 7
}

/** 转成周一优先的 7×24 矩阵 */
export function toMondayFirstHeatmap(raw: number[][] | null | undefined): number[][] {
  const byServerWeekday = normalizeHeatmap(raw)
  const rows: number[][] = []
  for (let rowIndex = 0; rowIndex < HEATMAP_ROWS; rowIndex++) {
    rows.push(
      byServerWeekday[rowIndexToWeekday(rowIndex)] ?? new Array<number>(HEATMAP_COLS).fill(0)
    )
  }
  return rows
}

/**
 * 把数值映射到 1–5 级（0 表示无数据）。相对最大值均分 5 档，
 * 最大值为 0 时所有单元格都返回 0。
 */
export function heatmapLevel(value: number, maxValue: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  if (!Number.isFinite(maxValue) || maxValue <= 0) return 0
  const ratio = Math.min(1, value / maxValue)
  return Math.min(HEATMAP_CLASSES, Math.max(1, Math.ceil(ratio * HEATMAP_CLASSES)))
}

/** 矩阵最大值，空矩阵返回 0 */
export function heatmapMax(rows: number[][]): number {
  let max = 0
  for (const row of rows) {
    for (const value of row) {
      if (Number.isFinite(value) && value > max) max = value
    }
  }
  return max
}

/** 汇总某一小时的 7 天点击数（用于单日 24 小时柱状图） */
export function sumHeatmapHours(rows: number[][]): number[] {
  const totals = new Array<number>(HEATMAP_COLS).fill(0)
  for (const row of rows) {
    for (let hour = 0; hour < HEATMAP_COLS; hour++) {
      const value = row[hour]
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        totals[hour] = (totals[hour] ?? 0) + value
      }
    }
  }
  return totals
}
