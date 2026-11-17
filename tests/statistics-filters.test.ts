import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FILTER_VALUES,
  buildAnalyticsQuery,
  buildStatisticsSearchParams,
  getEffectiveGranularity,
  getRequestedGranularity,
  parseStatisticsFilters,
  resolveFilterRange,
} from '../src/pages/statistics/utils/filters'
import { pickRangeDescriptionKey } from '../src/pages/statistics/utils/view'

const TODAY = new Date(2026, 9, 27)

function parse(query: string) {
  return parseStatisticsFilters(new URLSearchParams(query))
}

describe('URL search params -> 筛选值', () => {
  it('空 URL 使用默认值', () => {
    expect(parse('')).toEqual(DEFAULT_FILTER_VALUES)
  })

  it('非法参数回退到默认值', () => {
    const values = parse('range=bogus&g=year&limit=7')
    expect(values.preset).toBe('30d')
    expect(values.granularity).toBeNull()
    expect(values.limit).toBe(10)
  })

  it('解析合法的全部字段', () => {
    const values = parse(
      'range=custom&start=2026-10-01&end=2026-10-12&g=week&tag=t1&bookmark=b1&limit=50'
    )
    expect(values).toEqual({
      preset: 'custom',
      customStart: '2026-10-01',
      customEnd: '2026-10-12',
      granularity: 'week',
      tagId: 't1',
      bookmarkId: 'b1',
      limit: 50,
    })
  })

  it('非自定义区间忽略 start / end', () => {
    const values = parse('range=7d&start=2026-01-01&end=2026-01-02')
    expect(values.customStart).toBeNull()
    expect(values.customEnd).toBeNull()
  })

  it('空字符串的 tag / bookmark 视为未筛选', () => {
    const values = parse('tag=&bookmark=')
    expect(values.tagId).toBeNull()
    expect(values.bookmarkId).toBeNull()
  })
})

describe('筛选值 -> URL search params', () => {
  it('默认值不写入 URL，保持链接简洁', () => {
    expect(buildStatisticsSearchParams(DEFAULT_FILTER_VALUES).toString()).toBe('')
  })

  it('往返解析保持一致', () => {
    const values = {
      preset: 'custom' as const,
      customStart: '2026-10-01',
      customEnd: '2026-10-12',
      granularity: 'month' as const,
      tagId: 't1',
      bookmarkId: null,
      limit: 20 as const,
    }
    expect(parseStatisticsFilters(buildStatisticsSearchParams(values))).toEqual(values)
  })

  it('与预设默认值相同的粒度不写入 URL', () => {
    const params = buildStatisticsSearchParams({
      ...DEFAULT_FILTER_VALUES,
      preset: 'year',
      granularity: 'week',
    })
    expect(params.has('g')).toBe(false)
  })
})

describe('区间解析', () => {
  it('预设直接展开为日期', () => {
    const range = resolveFilterRange({ ...DEFAULT_FILTER_VALUES, preset: '7d' }, TODAY)
    expect(range).toEqual({
      start: '2026-10-21',
      end: '2026-10-27',
      days: 7,
      allTime: false,
      customError: null,
    })
  })

  it('全部时间没有起点，天数未知', () => {
    const range = resolveFilterRange({ ...DEFAULT_FILTER_VALUES, preset: 'all' }, TODAY)
    expect(range.start).toBeNull()
    expect(range.days).toBeNull()
    expect(range.allTime).toBe(true)
  })

  it('自定义区间非法时带上错误码', () => {
    const range = resolveFilterRange(
      {
        ...DEFAULT_FILTER_VALUES,
        preset: 'custom',
        customStart: '2026-10-27',
        customEnd: '2026-10-01',
      },
      TODAY
    )
    expect(range.customError).toBe('order')
    expect(range.start).toBeNull()
  })
})

describe('粒度解析', () => {
  it('URL 覆盖优先于预设默认值', () => {
    const values = {
      ...DEFAULT_FILTER_VALUES,
      preset: 'year' as const,
      granularity: 'day' as const,
    }
    expect(getRequestedGranularity(values)).toBe('day')
  })

  it('没有覆盖时使用预设默认粒度', () => {
    expect(getRequestedGranularity({ ...DEFAULT_FILTER_VALUES, preset: 'year' })).toBe('week')
    expect(getRequestedGranularity({ ...DEFAULT_FILTER_VALUES, preset: 'all' })).toBe('month')
  })

  it('>400 天时按日降级为按周', () => {
    expect(getEffectiveGranularity('day', 401)).toBe('week')
    expect(getEffectiveGranularity('day', 400)).toBe('day')
    expect(getEffectiveGranularity('month', 4000)).toBe('month')
  })
})

describe('buildAnalyticsQuery 请求参数', () => {
  const base = {
    start: '2026-10-01',
    end: '2026-10-27',
    timeZone: 'Asia/Shanghai',
    granularity: 'day' as const,
    limit: 10 as const,
    tagId: null,
    bookmarkId: null,
  }

  it('全部字段都被带上', () => {
    expect(buildAnalyticsQuery(base)).toEqual({
      startDate: '2026-10-01',
      endDate: '2026-10-27',
      tz: 'Asia/Shanghai',
      granularity: 'day',
      limit: 10,
      tagId: undefined,
      bookmarkId: undefined,
    })
  })

  it('全部时间省略 startDate', () => {
    const query = buildAnalyticsQuery({ ...base, start: null })
    expect(query.startDate).toBeUndefined()
    expect('startDate' in query).toBe(true)
  })

  it('筛选 id 透传', () => {
    const query = buildAnalyticsQuery({ ...base, tagId: 't1', bookmarkId: 'b1' })
    expect(query.tagId).toBe('t1')
    expect(query.bookmarkId).toBe('b1')
  })
})

describe('区间描述文案选择', () => {
  it('天数未知时退化为简短描述', () => {
    expect(pickRangeDescriptionKey({ days: null, allTime: true })).toBe('descriptionUnknown')
    expect(pickRangeDescriptionKey({ days: null, allTime: false })).toBe('descriptionUnknown')
  })

  it('全部时间带天数时使用全部时间文案', () => {
    expect(pickRangeDescriptionKey({ days: 900, allTime: true })).toBe('descriptionAllTime')
  })

  it('普通区间使用标准文案', () => {
    expect(pickRangeDescriptionKey({ days: 27, allTime: false })).toBe('description')
  })
})
