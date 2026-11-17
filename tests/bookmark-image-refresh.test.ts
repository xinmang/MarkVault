import { describe, expect, it } from 'vitest'
import { bookmarkImageRefreshInterval } from '../src/lib/bookmark-image-refresh'

const nowMs = 1_800_000_000_000
const nowSeconds = Math.floor(nowMs / 1000)
const minute = 60 * 1000

/** 构造与后端一致的本地签名图片地址 */
function localImage(hash: string, exp?: number | string): string {
  const params = new URLSearchParams({ u: 'user-1', b: 'bookmark-1', scope: 'owner', sig: 'signature' })
  if (exp !== undefined) params.set('exp', String(exp))
  return `/api/bookmark-images/images/${hash}?${params.toString()}`
}

/** 构造与后端一致的网站截图签名地址 */
function localScreenshot(exp?: number | string, scope: 'owner' | 'public' = 'owner'): string {
  const params = new URLSearchParams({ u: 'user-1', b: 'bookmark-1', scope, sig: 'signature' })
  if (exp !== undefined) params.set('exp', String(exp))
  return `/api/bookmark-screenshots/shot-1?${params.toString()}`
}

describe('bookmarkImageRefreshInterval', () => {
  it('没有带签名的本地图片时返回 false', () => {
    expect(bookmarkImageRefreshInterval([], nowMs)).toBe(false)
    expect(bookmarkImageRefreshInterval(null, nowMs)).toBe(false)
    expect(bookmarkImageRefreshInterval([{ cover_image: null, favicon: null }], nowMs)).toBe(false)
    // 外站图片没有过期问题
    expect(bookmarkImageRefreshInterval([{ cover_image: 'https://cdn.example.com/a.png' }], nowMs)).toBe(false)
    // 本地路径但缺少 exp（升级前缓存下来的无签名链接）不参与轮询
    expect(bookmarkImageRefreshInterval([{ favicon: '/api/bookmark-images/images/a.png' }], nowMs)).toBe(false)
  })

  it('外站地址即使带 exp 参数也不触发刷新', () => {
    const external = `https://example.com/a.png?exp=${nowSeconds + 600}&sig=signature`
    expect(bookmarkImageRefreshInterval([{ cover_image: external }], nowMs)).toBe(false)
    // 前缀相似但不是本地签名路径
    expect(
      bookmarkImageRefreshInterval([{ cover_image: `/other/api/bookmark-images/images/a.png?exp=${nowSeconds + 600}` }], nowMs)
    ).toBe(false)
  })

  it('按最早到期时间提前一分钟刷新，并同时识别封面与图标', () => {
    const later = nowSeconds + 1800
    const earlier = nowSeconds + 600
    expect(
      bookmarkImageRefreshInterval(
        [{ cover_image: localImage('a.png', earlier) }, { favicon: localImage('b.png', later) }],
        nowMs
      )
    ).toBe(earlier * 1000 - minute - nowMs)

    expect(
      bookmarkImageRefreshInterval(
        [{ cover_image: localImage('a.png', later), favicon: localImage('b.png', earlier) }],
        nowMs
      )
    ).toBe(earlier * 1000 - minute - nowMs)
  })

  it('已过期或已进入提前量的签名最短间隔一分钟，不紧密轮询', () => {
    expect(bookmarkImageRefreshInterval([{ cover_image: localImage('a.png', nowSeconds - 120) }], nowMs)).toBe(minute)
    // 距离到期不足一分钟，同样压到最短间隔
    expect(bookmarkImageRefreshInterval([{ cover_image: localImage('a.png', nowSeconds + 10) }], nowMs)).toBe(minute)
  })

  it('远超浏览器定时器上限的间隔会被钳制，不会溢出', () => {
    const farFuture = nowSeconds + 60 * 24 * 3600
    expect(bookmarkImageRefreshInterval([{ cover_image: localImage('a.png', farFuture) }], nowMs)).toBe(
      2_147_483_647
    )
  })

  it('无效 exp 不参与计算，也不会造成紧密轮询', () => {
    expect(bookmarkImageRefreshInterval([{ cover_image: localImage('a.png', 'abc') }], nowMs)).toBe(false)
    expect(bookmarkImageRefreshInterval([{ cover_image: localImage('a.png', '0') }], nowMs)).toBe(false)
    expect(bookmarkImageRefreshInterval([{ cover_image: localImage('a.png', '-5') }], nowMs)).toBe(false)
    expect(bookmarkImageRefreshInterval([{ cover_image: localImage('a.png', '1.5') }], nowMs)).toBe(false)
    // 超出安全整数范围的 exp 无法换算成可靠的毫秒值，直接忽略
    expect(
      bookmarkImageRefreshInterval([{ cover_image: localImage('a.png', Number.MAX_SAFE_INTEGER) }], nowMs)
    ).toBe(false)

    // 无效项不会把有效项的刷新时间拉近
    const valid = nowSeconds + 1800
    expect(
      bookmarkImageRefreshInterval(
        [{ cover_image: localImage('a.png', 'abc'), favicon: localImage('b.png', valid) }],
        nowMs
      )
    ).toBe(valid * 1000 - minute - nowMs)
  })

  it('网站截图同样按最早到期时间参与刷新', () => {
    const later = nowSeconds + 1800
    const earlier = nowSeconds + 900

    // 只有截图时也要刷新
    expect(
      bookmarkImageRefreshInterval([{ screenshot: { url: localScreenshot(earlier) } }], nowMs)
    ).toBe(earlier * 1000 - minute - nowMs)

    // 截图比封面更早到期时取截图
    expect(
      bookmarkImageRefreshInterval(
        [{ cover_image: localImage('a.png', later), screenshot: { url: localScreenshot(earlier) } }],
        nowMs
      )
    ).toBe(earlier * 1000 - minute - nowMs)

    // 封面更早到期时仍然取封面
    expect(
      bookmarkImageRefreshInterval(
        [{ cover_image: localImage('a.png', earlier), screenshot: { url: localScreenshot(later) } }],
        nowMs
      )
    ).toBe(earlier * 1000 - minute - nowMs)
  })

  it('公开分享页签发的截图地址也参与刷新', () => {
    const exp = nowSeconds + 600
    expect(
      bookmarkImageRefreshInterval([{ screenshot: { url: localScreenshot(exp, 'public') } }], nowMs)
    ).toBe(exp * 1000 - minute - nowMs)
  })

  it('缺少 exp 或不是本地截图路径时忽略 screenshot', () => {
    expect(bookmarkImageRefreshInterval([{ screenshot: null }], nowMs)).toBe(false)
    expect(bookmarkImageRefreshInterval([{ screenshot: { url: null } }], nowMs)).toBe(false)
    // 升级前缓存的旧数据没有截图字段
    expect(bookmarkImageRefreshInterval([{ cover_image: null }], nowMs)).toBe(false)
    // 本地路径但没有签名
    expect(
      bookmarkImageRefreshInterval([{ screenshot: { url: '/api/bookmark-screenshots/shot-1' } }], nowMs)
    ).toBe(false)
    // 外站地址即使带 exp 也不参与
    expect(
      bookmarkImageRefreshInterval(
        [{ screenshot: { url: `https://cdn.example.com/a.webp?exp=${nowSeconds + 600}` } }],
        nowMs
      )
    ).toBe(false)
    // 前缀相似但不是截图接口
    expect(
      bookmarkImageRefreshInterval(
        [{ screenshot: { url: `/other/api/bookmark-screenshots/a.webp?exp=${nowSeconds + 600}` } }],
        nowMs
      )
    ).toBe(false)
    // 无效 exp 不会造成紧密轮询，也不会影响有效项
    expect(
      bookmarkImageRefreshInterval([{ screenshot: { url: localScreenshot('abc') } }], nowMs)
    ).toBe(false)
    const valid = nowSeconds + 1800
    expect(
      bookmarkImageRefreshInterval(
        [{ screenshot: { url: localScreenshot('abc') } }, { favicon: localImage('b.png', valid) }],
        nowMs
      )
    ).toBe(valid * 1000 - minute - nowMs)
  })
})
