import { describe, expect, it } from 'vitest'
import { getHostname, isHttpUrl, isSafeImageSource } from '../src/pages/statistics/utils/url'
import { pickPeakBucket, ratioPercent } from '../src/pages/statistics/utils/view'

describe('isHttpUrl', () => {
  it('只接受 http / https', () => {
    expect(isHttpUrl('https://example.com/a')).toBe(true)
    expect(isHttpUrl('http://example.com')).toBe(true)
  })

  it('拒绝其它协议与非法输入', () => {
    expect(isHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isHttpUrl('data:text/html,<script>')).toBe(false)
    expect(isHttpUrl('//example.com')).toBe(false)
    expect(isHttpUrl('/api/bookmark-images/x')).toBe(false)
    expect(isHttpUrl('')).toBe(false)
    expect(isHttpUrl(null)).toBe(false)
    expect(isHttpUrl(undefined)).toBe(false)
  })
})

describe('getHostname', () => {
  it('去掉 www. 前缀', () => {
    expect(getHostname('https://www.example.com/a/b')).toBe('example.com')
    expect(getHostname('https://docs.example.com/x')).toBe('docs.example.com')
  })

  it('只取主机名（不含端口与路径）', () => {
    expect(getHostname('http://localhost:3000/x')).toBe('localhost')
    expect(getHostname('https://example.com:8443/a?b=1#c')).toBe('example.com')
  })

  it('非法 URL 原样返回（作为纯文本渲染）', () => {
    expect(getHostname('not a url')).toBe('not a url')
    expect(getHostname(null)).toBe('')
  })
})

describe('isSafeImageSource', () => {
  it('接受 http(s) 与 data:image', () => {
    expect(isSafeImageSource('https://example.com/favicon.ico')).toBe(true)
    expect(isSafeImageSource('http://example.com/f.png')).toBe(true)
    expect(isSafeImageSource('data:image/png;base64,AAAA')).toBe(true)
  })

  it('接受后端返回的同源签名 favicon 路径', () => {
    // 回归：应用自己的本地 favicon 曾被视为不安全而无法显示
    expect(
      isSafeImageSource('/api/bookmark-images/images/abc123?u=https%3A%2F%2Fx.com&sig=deadbeef')
    ).toBe(true)
    expect(isSafeImageSource('/favicon.ico')).toBe(true)
  })

  it('拒绝协议相对路径与伪协议', () => {
    expect(isSafeImageSource('//evil.example.com/x.png')).toBe(false)
    expect(isSafeImageSource('/\\evil.example.com/x.png')).toBe(false)
    expect(isSafeImageSource('javascript:alert(1)')).toBe(false)
    expect(isSafeImageSource('data:text/html;base64,AAAA')).toBe(false)
    expect(isSafeImageSource('ftp://example.com/x.png')).toBe(false)
  })

  it('拒绝空值', () => {
    expect(isSafeImageSource('')).toBe(false)
    expect(isSafeImageSource('   ')).toBe(false)
    expect(isSafeImageSource(null)).toBe(false)
    expect(isSafeImageSource(undefined)).toBe(false)
  })
})

describe('ratioPercent 排行条宽度', () => {
  it('按最大值换算百分比并夹到 0–100', () => {
    expect(ratioPercent(10, 20)).toBe(50)
    expect(ratioPercent(20, 20)).toBe(100)
    expect(ratioPercent(30, 20)).toBe(100)
  })

  it('最大值为 0 时返回 0，不产生 NaN', () => {
    expect(ratioPercent(0, 0)).toBe(0)
    expect(ratioPercent(5, 0)).toBe(0)
    expect(ratioPercent(Number.NaN, 10)).toBe(0)
    expect(ratioPercent(5, Number.NaN)).toBe(0)
  })
})

describe('pickPeakBucket', () => {
  const points = [
    {
      bucket: '2026-10-01',
      start_date: '2026-10-01',
      end_date: '2026-10-01',
      bookmark_clicks: 3,
      tag_clicks: 1,
    },
    {
      bucket: '2026-10-02',
      start_date: '2026-10-02',
      end_date: '2026-10-02',
      bookmark_clicks: 2,
      tag_clicks: 8,
    },
    {
      bucket: '2026-10-03',
      start_date: '2026-10-03',
      end_date: '2026-10-03',
      bookmark_clicks: 4,
      tag_clicks: 0,
    },
  ]

  it('两个序列都可见时按合计取峰值', () => {
    const peak = pickPeakBucket(points, true, true)
    expect(peak?.point.bucket).toBe('2026-10-02')
    expect(peak?.value).toBe(10)
  })

  it('只看书签序列时忽略标签点击', () => {
    const peak = pickPeakBucket(points, true, false)
    expect(peak?.point.bucket).toBe('2026-10-03')
    expect(peak?.value).toBe(4)
  })

  it('只看标签序列时忽略书签点击', () => {
    const peak = pickPeakBucket(points, false, true)
    expect(peak?.point.bucket).toBe('2026-10-02')
    expect(peak?.value).toBe(8)
  })

  it('没有任何点击时返回 null', () => {
    expect(pickPeakBucket([], true, true)).toBeNull()
    expect(
      pickPeakBucket(
        [
          {
            bucket: '2026-10-01',
            start_date: '2026-10-01',
            end_date: '2026-10-01',
            bookmark_clicks: 0,
            tag_clicks: 0,
          },
        ],
        true,
        true
      )
    ).toBeNull()
  })

  it('相同峰值取最早的一天', () => {
    const tied = points.map((point) => ({ ...point, bookmark_clicks: 5, tag_clicks: 0 }))
    expect(pickPeakBucket(tied, true, true)?.point.bucket).toBe('2026-10-01')
  })
})
