import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query'
import { shareService } from '@/services/share'
import type { ShareSettings, UpdateShareSettingsRequest, PublicSharePayload, PublicSharePaginatedPayload } from '@/lib/types'
import { bookmarkImageRefreshInterval } from '@/lib/bookmark-image-refresh'

export const SHARE_SETTINGS_QUERY_KEY = 'share-settings'

export function useShareSettings() {
  return useQuery<ShareSettings>({
    queryKey: [SHARE_SETTINGS_QUERY_KEY],
    queryFn: () => shareService.getSettings(),
    staleTime: 5 * 60 * 1000,
  })
}

export function useUpdateShareSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: UpdateShareSettingsRequest) => shareService.updateSettings(payload),
    onSuccess: (data: ShareSettings) => {
      queryClient.setQueryData([SHARE_SETTINGS_QUERY_KEY], data)
    },
  })
}

export function usePublicShare(slug: string, enabled: boolean) {
  return useQuery<PublicSharePayload>({
    queryKey: ['public-share', slug],
    queryFn: () => shareService.getPublicShare(slug),
    enabled: enabled && Boolean(slug),
    staleTime: 60 * 1000,
    // 公开分享的本地签名图片同样会过期，需要定时重新拉取换取新签名
    refetchInterval: (query) => bookmarkImageRefreshInterval(query.state.data?.bookmarks ?? []),
    refetchIntervalInBackground: false,
  })
}

export function useInfinitePublicShare(slug: string, enabled: boolean, pageSize = 30) {
  return useInfiniteQuery<PublicSharePaginatedPayload>({
    queryKey: ['public-share-infinite', slug, pageSize],
    queryFn: ({ pageParam }: { pageParam: unknown }) =>
      shareService.getPublicSharePaginated(slug, {
        page_size: pageSize,
        page_cursor: pageParam as string | undefined,
      }),
    enabled: enabled && Boolean(slug),
    staleTime: 60 * 1000,
    // 依据已加载的全部页计算签名图片刷新时间
    refetchInterval: (query) =>
      bookmarkImageRefreshInterval(
        query.state.data?.pages.flatMap((page) => page.bookmarks) ?? []
      ),
    refetchIntervalInBackground: false,
    initialPageParam: undefined,
    getNextPageParam: (lastPage: PublicSharePaginatedPayload) => {
      return lastPage.meta.has_more ? lastPage.meta.next_cursor : undefined
    },
  })
}
