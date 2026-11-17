import { describe, expect, it } from 'vitest'
import {
  HEATMAP_CLASSES,
  heatmapLevel,
  heatmapMax,
  normalizeHeatmap,
  rowIndexToWeekday,
  sumHeatmapHours,
  toMondayFirstHeatmap,
  weekdayToRowIndex,
} from '../src/pages/statistics/utils/heatmap'

/** 构造 7×24 的矩阵，每格填入 row*100+col 便于识别行映射 */
function makeMatrix(): number[][] {
  return Array.from({ length: 7 }, (_, row) =>
    Array.from({ length: 24 }, (_, col) => row * 100 + col)
  )
}

describe('周一优先的行映射', () => {
  it('服务端 0=周日 映射到最后一行', () => {
    expect(weekdayToRowIndex(0)).toBe(6)
    expect(weekdayToRowIndex(1)).toBe(0) // 周一
    expect(weekdayToRowIndex(2)).toBe(1)
    expect(weekdayToRowIndex(3)).toBe(2)
    expect(weekdayToRowIndex(4)).toBe(3)
    expect(weekdayToRowIndex(5)).toBe(4)
    expect(weekdayToRowIndex(6)).toBe(5) // 周六
  })

  it('反向映射与正向互逆', () => {
    for (let weekday = 0; weekday < 7; weekday++) {
      expect(rowIndexToWeekday(weekdayToRowIndex(weekday))).toBe(weekday)
    }
    for (let rowIndex = 0; rowIndex < 7; rowIndex++) {
      expect(weekdayToRowIndex(rowIndexToWeekday(rowIndex))).toBe(rowIndex)
    }
  })

  it('越界输入被归一化而不是抛错', () => {
    expect(weekdayToRowIndex(7)).toBe(6) // 7 ≡ 周日
    expect(weekdayToRowIndex(-1)).toBe(5) // -1 ≡ 周六
    expect(weekdayToRowIndex(8)).toBe(0) // 8 ≡ 周一
  })
})

describe('toMondayFirstHeatmap', () => {
  it('第一行来自服务端周一（index 1），最后一行来自周日（index 0）', () => {
    const rows = toMondayFirstHeatmap(makeMatrix())
    expect(rows).toHaveLength(7)
    expect(rows[0]?.[0]).toBe(100) // 周一
    expect(rows[5]?.[0]).toBe(600) // 周六
    expect(rows[6]?.[0]).toBe(0) // 周日
  })

  it('缺少行或列时按 0 补齐为 7×24', () => {
    const rows = toMondayFirstHeatmap([[1, 2, 3]])
    expect(rows).toHaveLength(7)
    expect(rows.every((row) => row.length === 24)).toBe(true)
    // 服务端第 0 行（周日）是 [1,2,3]，映射到显示的最后一行
    expect(rows[6]?.slice(0, 4)).toEqual([1, 2, 3, 0])
    expect(rows[0]?.every((value) => value === 0)).toBe(true)
  })

  it('null / 空输入返回全 0 的 7×24', () => {
    for (const input of [null, undefined, []]) {
      const rows = toMondayFirstHeatmap(input)
      expect(rows).toHaveLength(7)
      expect(rows.every((row) => row.length === 24 && row.every((v) => v === 0))).toBe(true)
    }
  })

  it('负数、NaN、非数字都被视为 0', () => {
    const rows = normalizeHeatmap([[-5, Number.NaN, 3]])
    expect(rows[0]?.slice(0, 4)).toEqual([0, 0, 3, 0])
  })

  it('多余的列被截断', () => {
    const wide = [Array.from({ length: 30 }, () => 1)]
    expect(normalizeHeatmap(wide)[0]).toHaveLength(24)
  })
})

describe('heatmapLevel 五级量化', () => {
  it('0 与负数属于「无数据」级别', () => {
    expect(heatmapLevel(0, 100)).toBe(0)
    expect(heatmapLevel(-3, 100)).toBe(0)
  })

  it('最大值落在最高级，其余按比例分 5 档', () => {
    expect(heatmapLevel(100, 100)).toBe(HEATMAP_CLASSES)
    expect(heatmapLevel(1, 100)).toBe(1)
    expect(heatmapLevel(20, 100)).toBe(1)
    expect(heatmapLevel(21, 100)).toBe(2)
    expect(heatmapLevel(60, 100)).toBe(3)
    expect(heatmapLevel(81, 100)).toBe(5)
  })

  it('最大值为 0 时所有单元格都是 0 级，不除零', () => {
    expect(heatmapLevel(5, 0)).toBe(0)
    expect(heatmapLevel(5, Number.NaN)).toBe(0)
  })

  it('超出最大值的输入被夹到最高级', () => {
    expect(heatmapLevel(500, 100)).toBe(HEATMAP_CLASSES)
  })
})

describe('heatmapMax 与 sumHeatmapHours', () => {
  it('矩阵最大值', () => {
    expect(
      heatmapMax([
        [1, 2],
        [9, 3],
      ])
    ).toBe(9)
    expect(heatmapMax([])).toBe(0)
    expect(heatmapMax([[0, 0]])).toBe(0)
  })

  it('按小时汇总 7 行', () => {
    const totals = sumHeatmapHours([
      [1, 0, 2],
      [0, 0, 3],
      [4, 0, 0],
    ])
    expect(totals).toHaveLength(24)
    expect(totals[0]).toBe(5)
    expect(totals[1]).toBe(0)
    expect(totals[2]).toBe(5)
    expect(totals.slice(3).every((value) => value === 0)).toBe(true)
  })

  it('空矩阵返回 24 个 0', () => {
    expect(sumHeatmapHours([])).toEqual(new Array<number>(24).fill(0))
  })
})
