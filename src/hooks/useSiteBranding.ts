import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { siteService } from '@/services/site'
import type { SiteBranding, SiteSettingsResponse, UpdateSiteSettingsRequest } from '@/lib/types'

export const SITE_BRANDING_QUERY_KEY = 'site-branding'
export const SITE_SETTINGS_QUERY_KEY = 'site-settings'

/**
 * 公开品牌信息。
 *
 * 品牌改动会立即影响全站，且缓存不写入持久化存储（见 lib/query-client.ts），
 * 因此每次重新打开或刷新应用都会重新读取服务端，不会长期显示旧站点名。
 */
export function usePublicSiteBranding() {
  return useQuery<SiteBranding>({
    queryKey: [SITE_BRANDING_QUERY_KEY],
    queryFn: () => siteService.getPublicSite(),
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    retry: 1,
  })
}

/**
 * 登录账号的品牌设置与 can_edit。
 * 缓存按当前账号 ID 分隔，切换账号后不会沿用上一个账号的可编辑状态。
 */
export function useSiteSettings(options: { enabled?: boolean; userId?: string | null } = {}) {
  return useQuery<SiteSettingsResponse>({
    queryKey: [SITE_SETTINGS_QUERY_KEY, options.userId ?? 'anonymous'],
    queryFn: () => siteService.getSettings(),
    enabled: options.enabled ?? true,
    staleTime: 60 * 1000,
  })
}

export function useUpdateSiteSettings(userId?: string | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: UpdateSiteSettingsRequest) => siteService.updateSettings(payload),
    onSuccess: (data: SiteSettingsResponse) => {
      queryClient.setQueryData([SITE_SETTINGS_QUERY_KEY, userId ?? 'anonymous'], data)
      queryClient.setQueryData([SITE_BRANDING_QUERY_KEY], data.site)
      // 公共品牌缓存立即失效并重新拉取，页头、登录页与分享页同步更新
      queryClient.invalidateQueries({ queryKey: [SITE_BRANDING_QUERY_KEY] }).catch(() => {
        // 重新拉取失败时保留已写入的最新值
      })
    },
  })
}
