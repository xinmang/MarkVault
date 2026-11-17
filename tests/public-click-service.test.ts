import { afterEach, describe, expect, it, vi } from 'vitest'
import { shareService } from '../src/services/share'

vi.mock('@/lib/api-client', () => ({ apiClient: {} }))
vi.mock('@/i18n', () => ({ default: { t: (key: string) => key } }))

afterEach(() => vi.unstubAllGlobals())

describe('公开点击匿名请求', () => {
  it('编码路径、不携带登录凭据，并在离开页面后继续发送', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    await shareService.recordPublicClick('owner/name', 'bookmarks', 'id/with?query')
    expect(fetch).toHaveBeenCalledWith(
      '/api/public/owner%2Fname/bookmarks/id%2Fwith%3Fquery/click',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        credentials: 'omit',
        keepalive: true,
      }
    )
    await shareService.recordPublicClick('owner', 'tags', 'tag-id')
    expect(fetch.mock.calls[1]?.[0]).toBe('/api/public/owner/tags/tag-id/click')
  })

  it('失败状态不会触发自动重试导致重复计数', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 429 }))
    vi.stubGlobal('fetch', fetch)
    await expect(shareService.recordPublicClick('owner', 'tags', 'tag-id')).rejects.toThrow('429')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
