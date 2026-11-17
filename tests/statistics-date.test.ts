import { describe, expect, it } from 'vitest'
import {
  DAILY_GRANULARITY_MAX_DAYS,
  DEFAULT_GRANULARITY_BY_PRESET,
  MAX_RANGE_DAYS,
  isGranularityDisabled,
  parseDateKey,
  parseGranularity,
  parseRangePreset,
  parseResultLimit,
  resolveGranularity,
  resolvePresetRange,
  validateCustomRange,
} from '../src/pages/statistics/utils/date'

/** 固定的“今天”，避免测试依赖真实时间 */
const TODAY = new Date(2026, 9, 27) // 2026-10-27 周二

describe('预设区间 -> {start, end}', () => {
  it('今天 / 昨天都是单日', () => {
    expect(resolvePresetRange('today', TODAY)).toEqual({
      start: '2026-10-27',
      end: '2026-10-27',
      days: 1,
    })
    expect(resolvePresetRange('yesterday', TODAY)).toEqual({
      start: '2026-10-26',
      end: '2026-10-26',
      days: 1,
    })
  })

  it('近 7 / 30 / 90 天包含今天，天数精确', () => {
    expect(resolvePresetRange('7d', TODAY)).toEqual({
      start: '2026-10-21',
      end: '2026-10-27',
      days: 7,
    })
    expect(resolvePresetRange('30d', TODAY)).toEqual({
      start: '2026-09-28',
      end: '2026-10-27',
      days: 30,
    })
    expect(resolvePresetRange('90d', TODAY)).toEqual({
      start: '2026-07-30',
      end: '2026-10-27',
      days: 90,
    })
  })

  it('本月从月初开始，今年从年初开始', () => {
    expect(resolvePresetRange('month', TODAY)).toEqual({
      start: '2026-10-01',
      end: '2026-10-27',
      days: 27,
    })
    expect(resolvePresetRange('year', TODAY)).toEqual({
      start: '2026-01-01',
      end: '2026-10-27',
      days: 300,
    })
  })

  it('全部时间不返回起点，天数未知', () => {
    expect(resolvePresetRange('all', TODAY)).toEqual({
      start: null,
      end: '2026-10-27',
      days: null,
    })
  })

  it('跨月、跨年、闰日都按自然日计算', () => {
    expect(resolvePresetRange('7d', new Date(2026, 2, 2)).start).toBe('2026-02-24')
    expect(resolvePresetRange('7d', new Date(2026, 0, 3)).start).toBe('2025-12-28')
    // 2028 是闰年，2 月有 29 天
    expect(resolvePresetRange('30d', new Date(2028, 2, 29)).days).toBe(30)
  })

  it('预设从不晚于今天', () => {
    for (const preset of ['today', 'yesterday', '7d', '30d', '90d', 'month', 'year'] as const) {
      expect(resolvePresetRange(preset, TODAY).end <= '2026-10-27').toBe(true)
    }
  })
})

describe('自定义区间校验', () => {
  it('缺少一端时提示未完成', () => {
    expect(validateCustomRange(null, '2026-10-27', TODAY)).toMatchObject({
      valid: false,
      error: 'incomplete',
    })
    expect(validateCustomRange('2026-10-01', null, TODAY)).toMatchObject({
      valid: false,
      error: 'incomplete',
    })
  })

  it('非法日期被拒绝', () => {
    expect(validateCustomRange('2026-02-31', '2026-10-27', TODAY)).toMatchObject({
      valid: false,
      error: 'invalid',
    })
    expect(validateCustomRange('2026/10/01', '2026-10-27', TODAY)).toMatchObject({
      valid: false,
      error: 'invalid',
    })
  })

  it('起点晚于终点时报顺序错误', () => {
    expect(validateCustomRange('2026-10-27', '2026-10-01', TODAY)).toMatchObject({
      valid: false,
      error: 'order',
    })
  })

  it('结束日期晚于今天时报未来错误', () => {
    expect(validateCustomRange('2026-10-01', '2026-10-28', TODAY)).toMatchObject({
      valid: false,
      error: 'future',
    })
  })

  it('跨度超过 3660 天时报过长', () => {
    expect(validateCustomRange('2010-01-01', '2026-10-27', TODAY)).toMatchObject({
      valid: false,
      error: 'tooLong',
    })
    // 恰好 3660 天是允许的
    const exact = validateCustomRange('2016-10-20', '2026-10-27', TODAY)
    expect(exact.valid).toBe(true)
    expect(exact.days).toBe(MAX_RANGE_DAYS)
    // 再多一天就被拒绝
    expect(validateCustomRange('2016-10-19', '2026-10-27', TODAY)).toMatchObject({
      valid: false,
      error: 'tooLong',
    })
  })

  it('合法区间返回含首尾的天数', () => {
    expect(validateCustomRange('2026-10-01', '2026-10-27', TODAY)).toEqual({
      valid: true,
      error: null,
      start: '2026-10-01',
      end: '2026-10-27',
      days: 27,
    })
    // 单日区间
    expect(validateCustomRange('2026-10-27', '2026-10-27', TODAY).days).toBe(1)
  })
})

describe('>400 天的粒度规则', () => {
  it('超过 400 天时按日无效，自动降级为按周', () => {
    expect(resolveGranularity('day', DAILY_GRANULARITY_MAX_DAYS + 1)).toBe('week')
    expect(isGranularityDisabled('day', DAILY_GRANULARITY_MAX_DAYS + 1)).toBe(true)
  })

  it('恰好 400 天仍可按日', () => {
    expect(resolveGranularity('day', DAILY_GRANULARITY_MAX_DAYS)).toBe('day')
    expect(isGranularityDisabled('day', DAILY_GRANULARITY_MAX_DAYS)).toBe(false)
  })

  it('周 / 月粒度不受跨度影响', () => {
    expect(resolveGranularity('week', 5000)).toBe('week')
    expect(resolveGranularity('month', 5000)).toBe('month')
    expect(isGranularityDisabled('week', 5000)).toBe(false)
  })

  it('天数未知（全部时间）时不降级', () => {
    expect(resolveGranularity('day', null)).toBe('day')
    expect(resolveGranularity('day', undefined)).toBe('day')
    expect(isGranularityDisabled('day', null)).toBe(false)
  })

  it('每个预设都有默认粒度，今年为周、全部为月', () => {
    expect(DEFAULT_GRANULARITY_BY_PRESET.year).toBe('week')
    expect(DEFAULT_GRANULARITY_BY_PRESET.all).toBe('month')
    expect(DEFAULT_GRANULARITY_BY_PRESET['30d']).toBe('day')
  })
})

describe('URL 参数解析与回退', () => {
  it('非法预设回退到 30d', () => {
    expect(parseRangePreset('nonsense')).toBe('30d')
    expect(parseRangePreset(null)).toBe('30d')
    expect(parseRangePreset('custom')).toBe('custom')
  })

  it('非法粒度返回 null，交给预设默认值', () => {
    expect(parseGranularity('year')).toBeNull()
    expect(parseGranularity('week')).toBe('week')
  })

  it('排行条数只接受 10 / 20 / 50', () => {
    expect(parseResultLimit('20')).toBe(20)
    expect(parseResultLimit('7')).toBe(10)
    expect(parseResultLimit(null)).toBe(10)
  })

  it('日期键严格校验（拒绝 2026-02-31 这类回卷日期）', () => {
    expect(parseDateKey('2026-10-27')).toBeInstanceOf(Date)
    expect(parseDateKey('2026-02-31')).toBeNull()
    expect(parseDateKey('2026-1-1')).toBeNull()
  })
})
