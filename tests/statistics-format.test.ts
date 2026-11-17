import { describe, expect, it } from 'vitest'
import {
  computeClickDelta,
  computeSharePercent,
  formatBucketFullLabel,
  formatBucketLabel,
  formatCompactNumber,
  formatHourPoint,
  formatHourRange,
  maxValueIndex,
  padHour,
} from '../src/pages/statistics/utils/format'

describe('formatCompactNumber 紧凑数字', () => {
  it('一万以下使用千分位', () => {
    expect(formatCompactNumber(0, 'en-US')).toBe('0')
    expect(formatCompactNumber(7, 'en-US')).toBe('7')
    expect(formatCompactNumber(1284, 'en-US')).toBe('1,284')
    expect(formatCompactNumber(9999, 'en-US')).toBe('9,999')
  })

  it('一万以上使用紧凑后缀', () => {
    expect(formatCompactNumber(12900, 'en-US')).toBe('12.9K')
    expect(formatCompactNumber(1_300_000, 'en-US')).toBe('1.3M')
  })

  it('中文使用万 / 亿单位', () => {
    expect(formatCompactNumber(12900, 'zh-CN')).toBe('1.3万')
  })

  it('非法数值回退为 0，不输出 NaN', () => {
    expect(formatCompactNumber(Number.NaN, 'en-US')).toBe('0')
    expect(formatCompactNumber(Number.POSITIVE_INFINITY, 'en-US')).toBe('0')
  })

  it('无效 locale 也不会抛错', () => {
    expect(() => formatCompactNumber(1234, 'not a locale!')).not.toThrow()
    expect(formatCompactNumber(1234, 'not a locale!')).toBe('1234')
  })
})

describe('computeClickDelta 与上一周期比较', () => {
  it('上一周期为 0 时视为无数据', () => {
    expect(computeClickDelta(10, 0)).toEqual({ direction: 'none', percent: null })
    expect(computeClickDelta(0, 0)).toEqual({ direction: 'none', percent: null })
  })

  it('上升 / 下降 / 持平', () => {
    expect(computeClickDelta(112, 100)).toEqual({ direction: 'up', percent: 12 })
    expect(computeClickDelta(80, 100)).toEqual({ direction: 'down', percent: 20 })
    expect(computeClickDelta(50, 50)).toEqual({ direction: 'flat', percent: 0 })
  })

  it('百分比取整，不使用负数', () => {
    expect(computeClickDelta(1, 3)).toEqual({ direction: 'down', percent: 67 })
  })

  it('非法输入不会产生 NaN', () => {
    expect(computeClickDelta(Number.NaN, 100)).toEqual({ direction: 'down', percent: 100 })
    expect(computeClickDelta(5, Number.NaN).direction).toBe('none')
  })
})

describe('computeSharePercent 占比', () => {
  it('正常计算并四舍五入', () => {
    expect(computeSharePercent(18, 100)).toBe(18)
    expect(computeSharePercent(1, 3)).toBe(33)
    expect(computeSharePercent(100, 100)).toBe(100)
  })

  it('总量为 0 时返回 null，避免除零', () => {
    expect(computeSharePercent(5, 0)).toBeNull()
    expect(computeSharePercent(0, 0)).toBeNull()
    expect(computeSharePercent(Number.NaN, 10)).toBeNull()
  })
})

describe('桶标签格式化', () => {
  it('按日 / 周显示月日', () => {
    expect(formatBucketLabel('2026-10-12', 'day', 'zh-CN')).toBe('10月12日')
    expect(formatBucketLabel('2026-10-12', 'week', 'zh-CN')).toBe('10月12日')
    expect(formatBucketLabel('2026-10-12', 'day', 'en-US')).toBe('Oct 12')
  })

  it('按月显示年月', () => {
    expect(formatBucketLabel('2026-10', 'month', 'zh-CN')).toBe('2026年10月')
    expect(formatBucketLabel('2026-10', 'month', 'en-US')).toBe('Oct 2026')
  })

  it('完整标签带年份', () => {
    expect(formatBucketFullLabel('2026-10-12', 'day', 'zh-CN')).toBe('2026年10月12日')
    expect(formatBucketFullLabel('2026-10', 'month', 'zh-CN')).toBe('2026年10月')
  })

  it('非法桶原样返回，不抛错', () => {
    expect(formatBucketLabel('garbage', 'day', 'zh-CN')).toBe('garbage')
    expect(formatBucketFullLabel('', 'month', 'en-US')).toBe('')
  })
})

describe('小时格式化', () => {
  it('补零', () => {
    expect(padHour(0)).toBe('00')
    expect(padHour(9)).toBe('09')
    expect(padHour(14)).toBe('14')
  })

  it('小时区间', () => {
    expect(formatHourPoint(14)).toBe('14:00')
    expect(formatHourRange(14)).toBe('14:00-15:00')
    expect(formatHourRange(23)).toBe('23:00-24:00')
  })

  it('越界小时被夹到合法范围', () => {
    expect(padHour(-3)).toBe('00')
    expect(padHour(99)).toBe('24')
  })
})

describe('maxValueIndex', () => {
  it('返回最大值下标', () => {
    expect(maxValueIndex([1, 5, 3])).toBe(1)
    expect(maxValueIndex([9])).toBe(0)
  })

  it('全 0 或空数组返回 -1', () => {
    expect(maxValueIndex([0, 0, 0])).toBe(-1)
    expect(maxValueIndex([])).toBe(-1)
    expect(maxValueIndex([Number.NaN, -1])).toBe(-1)
  })

  it('相同最大值取第一个', () => {
    expect(maxValueIndex([4, 4, 1])).toBe(0)
  })
})
