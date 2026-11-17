import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PublicShareSlugContext } from '../src/contexts/PublicShareSlugContext'
import { useRecordBookmarkClick, useRecordTagClick } from '../src/hooks/useClickTracking'
import type { Bookmark, PublicSharePayload } from '../src/lib/types'

const calls = vi.hoisted(() => ({
  public: vi.fn(),
  bookmark: vi.fn(),
  tag: vi.fn(),
  warn: vi.fn(),
}))
vi.mock('@/services/share', () => ({ shareService: { recordPublicClick: calls.public } }))
vi.mock('@/services/bookmarks', () => ({ bookmarksService: { recordClick: calls.bookmark } }))
vi.mock('@/services/tags', () => ({ tagsService: { incrementClick: calls.tag } }))
vi.mock('@/lib/logger', () => ({ logger: { warn: calls.warn } }))
vi.mock('@/hooks/useTags', () => ({ TAGS_QUERY_KEY: 'tags' }))

beforeEach(() => {
  vi.resetAllMocks()
  calls.public.mockResolvedValue(undefined)
  calls.bookmark.mockResolvedValue(undefined)
  calls.tag.mockResolvedValue(undefined)
})

const payload: PublicSharePayload = {
  profile: { username: 'owner', slug: 'owner', title: null, description: null },
  preferences: {} as PublicSharePayload['preferences'],
  generated_at: '2026-11-03T00:00:00.000Z',
  bookmarks: [{ id: 'bookmark', click_count: 3 } as Bookmark],
  tags: [{ id: 'tag', name: '公开标签', color: null, bookmark_count: 1, click_count: 2 }],
}

function renderTracking(slug: string | null, readOnly: boolean) {
  const client = new QueryClient()
  client.setQueryData(['public-share', 'owner'], payload)
  client.setQueryData(['public-share', 'other'], payload)
  let track!: { bookmark: (id: string) => Promise<void>; tag: (id: string) => Promise<void> }
  function Probe() {
    track = { bookmark: useRecordBookmarkClick(readOnly), tag: useRecordTagClick(readOnly) }
    return null
  }
  renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <PublicShareSlugContext.Provider value={slug}>
        <Probe />
      </PublicShareSlugContext.Provider>
    </QueryClientProvider>
  )
  return { client, track }
}

describe('公开分享点击路由与热度更新', () => {
  it('公开只读页将点击发往分享入口，并仅更新该分享缓存', async () => {
    const { client, track } = renderTracking('owner', true)
    await track.bookmark('bookmark')
    await track.tag('tag')
    expect(calls.public.mock.calls).toEqual([
      ['owner', 'bookmarks', 'bookmark'],
      ['owner', 'tags', 'tag'],
    ])
    expect(calls.bookmark).not.toHaveBeenCalled()
    expect(calls.tag).not.toHaveBeenCalled()
    const updated = client.getQueryData<PublicSharePayload>(['public-share', 'owner'])!
    expect(updated.bookmarks[0]?.click_count).toBe(4)
    expect(updated.tags[0]?.click_count).toBe(3)
    expect(client.getQueryData(['public-share', 'other'])).toEqual(payload)
    client.clear()
  })

  it('普通只读视图没有分享上下文时不发送统计请求', async () => {
    const { client, track } = renderTracking(null, true)
    await track.bookmark('bookmark')
    await track.tag('tag')
    expect(calls.public).not.toHaveBeenCalled()
    expect(calls.bookmark).not.toHaveBeenCalled()
    expect(calls.tag).not.toHaveBeenCalled()
    client.clear()
  })

  it('本人页面保持原有认证接口，并在标签点击后刷新标签缓存', async () => {
    const { client, track } = renderTracking(null, false)
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    await track.bookmark('bookmark')
    await track.tag('tag')
    expect(calls.public).not.toHaveBeenCalled()
    expect(calls.bookmark).toHaveBeenCalledWith('bookmark')
    expect(calls.tag).toHaveBeenCalledWith('tag')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tags'] })
    client.clear()
  })

  it('失败不抛出异常、不重试，也不增加页面热度', async () => {
    calls.public.mockRejectedValue(new Error('分享已撤销'))
    const { client, track } = renderTracking('owner', true)
    await expect(track.bookmark('bookmark')).resolves.toBeUndefined()
    await expect(track.tag('tag')).resolves.toBeUndefined()
    expect(calls.public).toHaveBeenCalledTimes(2)
    expect(calls.warn).toHaveBeenCalledTimes(2)
    expect(client.getQueryData(['public-share', 'owner'])).toEqual(payload)
    client.clear()
  })
})
