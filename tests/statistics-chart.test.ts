import { describe, expect, it } from 'vitest'
import {
  barSlotGeometry,
  buildAreaPath,
  buildBarPath,
  buildLinePath,
  clampNumber,
  niceTicks,
  pickLabelIndices,
  scaleMaxFor,
} from '../src/pages/statistics/utils/chart'

describe('niceTicks 生成干净的刻度', () => {
  it('小数值使用 1/2/5 步长', () => {
    expect(niceTicks(9, 4)).toEqual([0, 2, 4, 6, 8, 10])
    expect(niceTicks(3, 3)).toEqual([0, 1, 2, 3])
    expect(niceTicks(1, 4)).toEqual([0, 1])
  })

  it('大数值保持紧凑的 1/2/5 步长', () => {
    expect(niceTicks(1234, 4)).toEqual([0, 500, 1000, 1500])
    expect(niceTicks(2000, 4)).toEqual([0, 500, 1000, 1500, 2000])
    expect(niceTicks(12000, 4)).toEqual([0, 2000, 4000, 6000, 8000, 10000, 12000])
    expect(niceTicks(20260, 4)).toEqual([0, 5000, 10000, 15000, 20000, 25000])
  })

  it('刻度数量保持在可读范围（2–7 条）', () => {
    for (const max of [1, 2, 3, 7, 9, 13, 99, 101, 777, 1234, 2000, 12000, 20260]) {
      const ticks = niceTicks(max, 4)
      expect(ticks.length).toBeGreaterThanOrEqual(2)
      expect(ticks.length).toBeLessThanOrEqual(7)
    }
  })

  it('刻度从 0 开始且单调递增，最大值被覆盖', () => {
    for (const max of [1, 7, 13, 99, 101, 777, 20260]) {
      const ticks = niceTicks(max, 4)
      expect(ticks[0]).toBe(0)
      const top = ticks[ticks.length - 1] ?? 0
      expect(top).toBeGreaterThanOrEqual(max)
      for (let i = 1; i < ticks.length; i++) {
        expect(ticks[i]!).toBeGreaterThan(ticks[i - 1]!)
      }
    }
  })

  it('0 / 负数 / NaN 不会产生空刻度或 NaN', () => {
    expect(niceTicks(0)).toEqual([0, 1])
    expect(niceTicks(-5)).toEqual([0, 1])
    expect(niceTicks(Number.NaN)).toEqual([0, 1])
    expect(niceTicks(Number.POSITIVE_INFINITY)).toEqual([0, 1])
  })
})

describe('scaleMaxFor 与 niceTicks 一致', () => {
  it('返回最大刻度，永远大于 0', () => {
    expect(scaleMaxFor(9, 4)).toBe(10)
    expect(scaleMaxFor(1234, 4)).toBe(1500)
    expect(scaleMaxFor(0, 4)).toBe(1)
    expect(scaleMaxFor(Number.NaN, 4)).toBe(1)
  })
})

describe('pickLabelIndices 抽稀 x 轴标签', () => {
  it('宽度足够时全部显示', () => {
    expect(pickLabelIndices(5, 600, 56)).toEqual([0, 1, 2, 3, 4])
  })

  it('宽度不足时按步长抽稀，并保留首尾', () => {
    const indices = pickLabelIndices(30, 420, 64)
    expect(indices.length).toBeGreaterThanOrEqual(2)
    expect(indices[0]).toBe(0)
    expect(indices[indices.length - 1]).toBe(29)
    // 相邻标签（含最后两个）间距都不小于最小间距
    for (let i = 1; i < indices.length; i++) {
      expect((indices[i]! - indices[i - 1]!) * (420 / 29)).toBeGreaterThanOrEqual(64)
    }
  })

  it('末尾标签不会和倒数第二个挤在一起', () => {
    // 30 个桶、步长 2 时最后一个桶紧挨着倒数第二个标签，应当去掉后者
    const indices = pickLabelIndices(30, 1000, 64)
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]! - indices[i - 1]!).toBeGreaterThanOrEqual(2)
    }
    expect(indices[indices.length - 1]).toBe(29)
  })

  it('边界输入不会崩溃', () => {
    expect(pickLabelIndices(0, 300)).toEqual([])
    expect(pickLabelIndices(1, 300)).toEqual([0])
    expect(pickLabelIndices(10, 0)).toEqual([0, 9])
    expect(pickLabelIndices(10, Number.NaN)).toEqual([0, 9])
  })

  it('标签数量控制在 6–8 个左右', () => {
    const indices = pickLabelIndices(90, 560, 64)
    expect(indices.length).toBeLessThanOrEqual(9)
    expect(indices.length).toBeGreaterThanOrEqual(6)
  })
})

describe('路径构造', () => {
  it('折线路径为空数组时返回空串', () => {
    expect(buildLinePath([])).toBe('')
    expect(buildAreaPath([], 100)).toBe('')
  })

  it('折线路径使用 M/L 指令', () => {
    expect(
      buildLinePath([
        { x: 0, y: 10 },
        { x: 5, y: 20 },
      ])
    ).toBe('M0 10 L5 20')
  })

  it('面积路径在基线处闭合', () => {
    const d = buildAreaPath(
      [
        { x: 0, y: 10 },
        { x: 5, y: 20 },
      ],
      100
    )
    expect(d.startsWith('M0 10 L5 20')).toBe(true)
    expect(d.endsWith('L0 100 Z')).toBe(true)
  })

  it('柱形路径顶部圆角、底部直角，零高度返回空串', () => {
    const d = buildBarPath(10, 50, 12, 40, 4)
    expect(d.startsWith('M10 90')).toBe(true)
    expect(d.endsWith('Z')).toBe(true)
    expect(buildBarPath(10, 50, 12, 0, 4)).toBe('')
  })

  it('圆角半径不超过柱宽的一半', () => {
    const d = buildBarPath(0, 0, 4, 20, 10)
    // r = min(10, 2, 20) = 2
    expect(d).toContain('Q0 0 2 0')
  })
})

describe('barSlotGeometry 柱宽限制', () => {
  it('柱宽不超过 24px，也不填满槽位', () => {
    const wide = barSlotGeometry(1000, 4, 24, 0.62)
    expect(wide.barWidth).toBeLessThanOrEqual(24)
    expect(wide.barWidth).toBeLessThan(wide.slot)

    const narrow = barSlotGeometry(240, 24, 24, 0.62)
    expect(narrow.barWidth).toBeLessThanOrEqual(24)
    expect(narrow.barWidth).toBeLessThan(narrow.slot)
  })

  it('退化输入不产生 NaN 或负数', () => {
    expect(barSlotGeometry(0, 10)).toEqual({ slot: 0, barWidth: 0 })
    expect(barSlotGeometry(100, 0)).toEqual({ slot: 0, barWidth: 0 })
    expect(barSlotGeometry(Number.NaN, 5)).toEqual({ slot: 0, barWidth: 0 })
  })
})

describe('clampNumber 夹逼', () => {
  it('NaN 回退到下限', () => {
    expect(clampNumber(Number.NaN, 2, 8)).toBe(2)
    expect(clampNumber(-3, 0, 10)).toBe(0)
    expect(clampNumber(30, 0, 10)).toBe(10)
    expect(clampNumber(5, 0, 10)).toBe(5)
  })
})
