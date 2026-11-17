import { useCallback, useContext } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { PublicShareSlugContext } from '@/contexts/PublicShareSlugContext'
import { bookmarksService } from '@/services/bookmarks'
import { shareService } from '@/services/share'
import { tagsService } from '@/services/tags'
import type { PublicSharePayload } from '@/lib/types'
import { logger } from '@/lib/logger'
import { TAGS_QUERY_KEY } from './useTags'

/** 点击记录在后台完成，失败不能阻止打开书签或切换标签。 */
function useClickTracking(kind: 'bookmarks' | 'tags', readOnly: boolean) {
  const slug = useContext(PublicShareSlugContext)
  const queryClient = useQueryClient()

  return useCallback(
    async (id: string) => {
      if (!slug && readOnly) return
      try {
        if (slug) {
          await shareService.recordPublicClick(slug, kind, id)
          // 仅更新该分享页的热度，不读取或刷新访客自己的账号数据。
          queryClient.setQueryData<PublicSharePayload>(['public-share', slug], (previous) => {
            if (!previous) return previous
            if (kind === 'bookmarks') {
              return {
                ...previous,
                bookmarks: previous.bookmarks.map((bookmark) =>
                  bookmark.id === id
                    ? { ...bookmark, click_count: (bookmark.click_count ?? 0) + 1 }
                    : bookmark
                ),
              }
            }
            return {
              ...previous,
              tags: previous.tags.map((tag) =>
                tag.id === id ? { ...tag, click_count: (tag.click_count ?? 0) + 1 } : tag
              ),
            }
          })
        } else if (kind === 'bookmarks') {
          await bookmarksService.recordClick(id)
        } else {
          await tagsService.incrementClick(id)
          await queryClient.invalidateQueries({ queryKey: [TAGS_QUERY_KEY] })
        }
      } catch (error) {
        logger.warn('记录点击失败：', error)
      }
    },
    [kind, queryClient, readOnly, slug]
  )
}

export function useRecordBookmarkClick(readOnly = false) {
  return useClickTracking('bookmarks', readOnly)
}

export function useRecordTagClick(readOnly = false) {
  return useClickTracking('tags', readOnly)
}
