import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { preferencesService } from '@/services/preferences'
import type { UpdatePreferencesRequest, UserPreferences } from '@/lib/types'
import { ApiError } from '@/lib/api-client'
import { logger } from '@/lib/logger'
import { VIEW_MODES, type ViewMode } from '@/lib/constants/bookmarks'
import { DEFAULT_MOTION_PREFERENCES } from '@/lib/motion'
import { DEFAULT_OCEAN_PREFERENCES } from '@/lib/ocean-background'
import { useAuthStore } from '@/stores/authStore'

export const PREFERENCES_QUERY_KEY = 'preferences'
const PREFERENCES_STORAGE_KEY = 'markvault:preferences'

// 从 localStorage 获取完整偏好设置
export function getStoredPreferences(): UserPreferences | null {
  if (typeof window === 'undefined') return null

  try {
    const stored = window.localStorage.getItem(PREFERENCES_STORAGE_KEY)
    if (stored) {
      const preferences = JSON.parse(stored) as UserPreferences
      const uid = useAuthStore.getState().user?.id
      if (uid && preferences.user_id && preferences.user_id !== uid) return null
      return preferences
    }
  } catch (error) {
    logger.error('Failed to parse stored preferences:', error)
  }

  return null
}

// 保存偏好设置到 localStorage
function saveStoredPreferences(preferences: UserPreferences): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences))
  } catch (error) {
    logger.error('Failed to save preferences to localStorage:', error)
  }
}

// 从 localStorage 获取视图模式（向后兼容）
function getStoredViewMode(): ViewMode | null {
  if (typeof window === 'undefined') return null
  const stored = window.localStorage.getItem('markvault:view_mode')
  return stored && (VIEW_MODES as readonly string[]).includes(stored) ? (stored as ViewMode) : null
}

function parsePreferenceTimestamp(value?: string): number {
  if (!value) return 0

  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value
  const timestamp = Date.parse(normalized)
  return Number.isFinite(timestamp) ? timestamp : 0
}

// 默认偏好设置
function getDefaultPreferences(): UserPreferences {
  // 向后兼容：使用旧的视图模式存储
  const storedViewMode = getStoredViewMode()
  const defaults: UserPreferences = {
    user_id: '',
    theme: 'light',
    page_size: 30,
    bookmark_initial_count: 30,
    bookmark_load_more_expiry_minutes: 5,
    view_mode: storedViewMode || 'list',
    density: 'normal',
    tag_layout: 'grid',
    show_tag_icons: true,
    tag_sort_by: 'usage',
    sort_by: 'created',
    search_auto_clear_seconds: 15,
    tag_selection_auto_clear_seconds: 30,
    enable_search_auto_clear: true,
    enable_tag_selection_auto_clear: false,
    default_bookmark_icon: 'orbital-spinner',
    snapshot_retention_count: 5,
    experimental_vibehub_theme_enabled: false,
    experimental_uiux_pro_theme_enabled: false,
    experimental_ascii_theme_enabled: false,
    experimental_liquid_glass_theme_enabled: false,
    experimental_tag_heat_enabled: false,
    experimental_tag_heat_style: 'fill',
    experimental_tag_heat_effect: 'auto',
    experimental_tag_heat_color: '#3b82f6',
    experimental_tag_heat_intensity: 65,
    experimental_url_privacy_enabled: false,
    experimental_url_privacy_effect: 'blur',
    experimental_url_privacy_strength: 6,
    experimental_hover_card_enabled: false,
    experimental_hover_card_theme: 'creature',
    experimental_hover_card_effect: 'auto',
    experimental_hover_card_accent_color: '#e11d48',
    experimental_hover_card_intensity: 75,
    experimental_hover_card_size: 100,
    experimental_hover_card_delay: 450,
    experimental_hover_card_advanced_clicks: 5,
    experimental_hover_card_collector_clicks: 20,
    experimental_hover_card_secret_clicks: 50,
    experimental_hover_card_shuffle_enabled: false,
    ...DEFAULT_MOTION_PREFERENCES,
    ...DEFAULT_OCEAN_PREFERENCES,
    updated_at: new Date().toISOString(),
  }

  // 合并默认值，确保旧版 localStorage 缺少新增字段时仍能正常工作。
  const storedPreferences = getStoredPreferences()
  return storedPreferences ? { ...defaults, ...storedPreferences } : defaults
}

// 查询缓存的持久化写入有延迟；立即刷新时必须优先采用较新的本地偏好。
export function selectLatestStoredPreferences(cached: UserPreferences): UserPreferences {
  const defaults = getDefaultPreferences()
  const uid = useAuthStore.getState().user?.id
  if (uid && cached.user_id && cached.user_id !== uid) return defaults
  const stored = getStoredPreferences()
  if (
    stored &&
    parsePreferenceTimestamp(stored.updated_at) > parsePreferenceTimestamp(cached.updated_at)
  ) {
    return { ...defaults, ...cached, ...stored }
  }
  return { ...defaults, ...cached }
}

/**
 * 获取用户偏好设置
 * 优先使用 localStorage，后台异步从服务器同步
 */
export function usePreferences(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [PREFERENCES_QUERY_KEY],
    enabled: options.enabled ?? true,
    select: selectLatestStoredPreferences,
    queryFn: async () => {
      // 1. 立即返回 localStorage 中的偏好设置
      const localPreferences = getDefaultPreferences()

      // 2. 后台异步从服务器获取最新设置
      try {
        const serverPreferences = await preferencesService.getPreferences()

        // 3. 如果服务器设置更新，保存到 localStorage
        const latestStoredPreferences = getStoredPreferences()
        const serverUpdatedAt = parsePreferenceTimestamp(serverPreferences.updated_at)
        const localUpdatedAt = parsePreferenceTimestamp(latestStoredPreferences?.updated_at)
        if (!latestStoredPreferences || serverUpdatedAt >= localUpdatedAt) {
          saveStoredPreferences(serverPreferences)
          return serverPreferences
        }

        // 请求期间可能刚修改过偏好，不能让较旧的服务器响应覆盖用户的新选择。
        return { ...localPreferences, ...latestStoredPreferences }
      } catch (error) {
        // 服务器获取失败，使用本地设置
        if (error instanceof ApiError && error.status === 404) {
          logger.warn('Preferences API not found, using localStorage preferences')
        } else {
          logger.warn('Failed to fetch server preferences, using localStorage:', error)
        }
      }

      return localPreferences
    },
    // 减少重试次数,避免频繁请求不存在的接口
    retry: false,
    // 增加缓存时间,减少请求频率
    staleTime: 24 * 60 * 60 * 1000, // 24小时 (偏好很少变化)
    // 登录到另一浏览器或重新聚焦页面时检查账号设置，不能被一天的缓存阻止同步。
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    gcTime: 7 * 24 * 60 * 60 * 1000, // 7天
    // 立即返回缓存数据，后台更新
    placeholderData: getDefaultPreferences(),
  })
}

/**
 * 更新用户偏好设置
 * 日常操作先更新本地；设置页可要求服务器确认后再更新本地缓存。
 */
export function useUpdatePreferences(options: { requireServer?: boolean } = {}) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: UpdatePreferencesRequest) => {
      if (options.requireServer) {
        // 设置页明确承诺账号同步：服务器失败时保留草稿，不伪装成本地保存成功。
        const serverPreferences = await preferencesService.updatePreferences(data)
        saveStoredPreferences(serverPreferences)
        queryClient.setQueryData([PREFERENCES_QUERY_KEY], serverPreferences)
        return serverPreferences
      }
      // 1. 立即更新 localStorage
      const currentPreferences = getDefaultPreferences()
      const updatedPreferences: UserPreferences = {
        ...currentPreferences,
        ...data,
        updated_at: new Date().toISOString(),
      }
      saveStoredPreferences(updatedPreferences)

      // 2. 立即更新 React Query 缓存
      queryClient.setQueryData([PREFERENCES_QUERY_KEY], updatedPreferences)

      // 3. 后台异步同步到服务器
      try {
        return await preferencesService.updatePreferences(data)
      } catch (error) {
        // 服务器同步失败不影响本地使用
        logger.warn('Failed to sync preferences to server, but local changes are saved:', error)
        return updatedPreferences
      }
    },
    onSuccess: (serverPreferences) => {
      void queryClient.invalidateQueries({queryKey:['plugins']})
      // 如果服务器返回了更新的设置，保存到 localStorage
      if (serverPreferences) {
        const storedPreferences = getStoredPreferences()
        const serverUpdatedAt = parsePreferenceTimestamp(serverPreferences.updated_at)
        const localUpdatedAt = parsePreferenceTimestamp(storedPreferences?.updated_at)
        if (!storedPreferences || serverUpdatedAt >= localUpdatedAt) {
          saveStoredPreferences(serverPreferences)
          queryClient.setQueryData([PREFERENCES_QUERY_KEY], serverPreferences)
        }
      }
    },
    onError: (error) => {
      logger.warn(
        options.requireServer ? '账号偏好保存失败，草稿未保存：' : '偏好同步失败，本地修改仍保留：',
        error
      )
    },
    // 失败时不重试,避免频繁请求
    retry: false,
  })
}
