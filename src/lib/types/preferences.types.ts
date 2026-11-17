import { Bookmark, Tag } from './bookmark.types'
import type { TagLayout, ViewMode } from '@/lib/constants/bookmarks'
import type { OceanPreferences } from '@shared/ocean-preferences'

export type TagLayoutPreference = TagLayout
export type TagSortPreference = 'usage' | 'name' | 'clicks'
export type SortByPreference = 'created' | 'updated' | 'pinned' | 'popular'

export type DefaultBookmarkIcon = 'favicon' | 'letter' | 'hash' | 'none' | 'orbital-spinner'
export type ExperimentalTagHeatStyle = 'fill' | 'progress' | 'liquid' | 'rarity'
export type ExperimentalTagHeatEffect =
  | 'auto'
  | 'foil'
  | 'diamond'
  | 'sparkle'
  | 'prism'
  | 'galaxy'
  | 'none'
export type ExperimentalUrlPrivacyEffect = 'blur' | 'mosaic' | 'mask'
export type ExperimentalHoverCardTheme = 'creature' | 'duelist' | 'arcane'
export type ExperimentalHoverCardEffect = 'auto' | 'foil' | 'prism' | 'galaxy' | 'none'
export type MotionIntensity = 'subtle' | 'standard' | 'lively'
export type MotionCardHover = 'none' | 'lift' | 'tilt' | 'glow'
export type MotionListEntrance = 'none' | 'fade' | 'rise' | 'scale'

/** 界面动效偏好，与 user_preferences 中的 motion_* 列一一对应 */
export interface MotionPreferences {
  motion_enabled: boolean
  /** 动画速度百分比，50–200，越大越快 */
  motion_speed: number
  motion_intensity: MotionIntensity
  motion_button_feedback: boolean
  motion_card_hover: MotionCardHover
  motion_list_entrance: MotionListEntrance
  motion_tag_linkage: boolean
  motion_page_transition: boolean
}

export interface UserPreferences extends MotionPreferences, OceanPreferences {
  user_id?: string
  theme: 'light' | 'dark' | 'system'
  page_size: number
  bookmark_initial_count: number
  bookmark_load_more_expiry_minutes: number
  view_mode: ViewMode
  density: 'compact' | 'normal' | 'comfortable'
  tag_layout: TagLayoutPreference
  show_tag_icons: boolean
  tag_sort_by: TagSortPreference
  sort_by: SortByPreference
  search_auto_clear_seconds: number
  tag_selection_auto_clear_seconds: number
  enable_search_auto_clear: boolean
  enable_tag_selection_auto_clear: boolean
  default_bookmark_icon: DefaultBookmarkIcon
  snapshot_retention_count: number
  experimental_vibehub_theme_enabled: boolean
  experimental_uiux_pro_theme_enabled: boolean
  experimental_ascii_theme_enabled: boolean
  experimental_liquid_glass_theme_enabled: boolean
  experimental_tag_heat_enabled: boolean
  experimental_tag_heat_style: ExperimentalTagHeatStyle
  experimental_tag_heat_effect: ExperimentalTagHeatEffect
  experimental_tag_heat_color: string
  experimental_tag_heat_intensity: number
  experimental_url_privacy_enabled: boolean
  experimental_url_privacy_effect: ExperimentalUrlPrivacyEffect
  experimental_url_privacy_strength: number
  experimental_hover_card_enabled: boolean
  experimental_hover_card_theme: ExperimentalHoverCardTheme
  experimental_hover_card_effect: ExperimentalHoverCardEffect
  experimental_hover_card_accent_color: string
  experimental_hover_card_intensity: number
  experimental_hover_card_size: number
  experimental_hover_card_delay: number
  experimental_hover_card_advanced_clicks: number
  experimental_hover_card_collector_clicks: number
  experimental_hover_card_secret_clicks: number
  experimental_hover_card_shuffle_enabled: boolean
  updated_at: string
}

export interface UpdatePreferencesRequest extends Partial<MotionPreferences>, Partial<OceanPreferences> {
  theme?: 'light' | 'dark' | 'system'
  page_size?: number
  bookmark_initial_count?: number
  bookmark_load_more_expiry_minutes?: number
  view_mode?: ViewMode
  density?: 'compact' | 'normal' | 'comfortable'
  tag_layout?: TagLayoutPreference
  show_tag_icons?: boolean
  tag_sort_by?: TagSortPreference
  sort_by?: SortByPreference
  search_auto_clear_seconds?: number
  tag_selection_auto_clear_seconds?: number
  enable_search_auto_clear?: boolean
  enable_tag_selection_auto_clear?: boolean
  search_debounce_ms?: number
  mobile_edit_auto_cancel_seconds?: number
  double_click_delay_ms?: number
  enable_edit_confirmation?: boolean
  default_bookmark_icon?: DefaultBookmarkIcon
  snapshot_retention_count?: number
  experimental_vibehub_theme_enabled?: boolean
  experimental_uiux_pro_theme_enabled?: boolean
  experimental_ascii_theme_enabled?: boolean
  experimental_liquid_glass_theme_enabled?: boolean
  experimental_tag_heat_enabled?: boolean
  experimental_tag_heat_style?: ExperimentalTagHeatStyle
  experimental_tag_heat_effect?: ExperimentalTagHeatEffect
  experimental_tag_heat_color?: string
  experimental_tag_heat_intensity?: number
  experimental_url_privacy_enabled?: boolean
  experimental_url_privacy_effect?: ExperimentalUrlPrivacyEffect
  experimental_url_privacy_strength?: number
  experimental_hover_card_enabled?: boolean
  experimental_hover_card_theme?: ExperimentalHoverCardTheme
  experimental_hover_card_effect?: ExperimentalHoverCardEffect
  experimental_hover_card_accent_color?: string
  experimental_hover_card_intensity?: number
  experimental_hover_card_size?: number
  experimental_hover_card_delay?: number
  experimental_hover_card_advanced_clicks?: number
  experimental_hover_card_collector_clicks?: number
  experimental_hover_card_secret_clicks?: number
  experimental_hover_card_shuffle_enabled?: boolean
  enable_animations?: boolean
  animation_speed?: 'fast' | 'normal' | 'slow'
  enable_virtual_scroll?: boolean
  toast_duration_seconds?: number
  enable_success_sound?: boolean
  auto_copy_share_link?: boolean
  auto_save_delay_seconds?: number
  warn_unsaved_changes?: boolean
  show_bookmark_thumbnails?: boolean
  show_bookmark_descriptions?: boolean
  show_tag_colors?: boolean
  sidebar_default_expanded?: boolean
}

export interface PreferencesResponse {
  preferences: UserPreferences
}

export interface ShareSettings {
  enabled: boolean
  slug: string | null
  title: string | null
  description: string | null
}

export interface ShareSettingsResponse {
  share: ShareSettings
}

export interface R2StorageQuota {
  used_bytes: number
  limit_bytes: number | null
  unlimited: boolean
}

export interface R2StorageQuotaResponse {
  quota: R2StorageQuota
}

export interface UpdateShareSettingsRequest {
  enabled?: boolean
  slug?: string | null
  title?: string | null
  description?: string | null
  regenerate_slug?: boolean
}

export type PublicDisplayPreferences = Pick<
  UserPreferences,
  | 'view_mode'
  | 'tag_layout'
  | 'show_tag_icons'
  | 'tag_sort_by'
  | 'sort_by'
  | 'default_bookmark_icon'
  | 'experimental_vibehub_theme_enabled'
  | 'experimental_uiux_pro_theme_enabled'
  | 'experimental_ascii_theme_enabled'
  | 'experimental_liquid_glass_theme_enabled'
  | 'experimental_tag_heat_enabled'
  | 'experimental_tag_heat_style'
  | 'experimental_tag_heat_effect'
  | 'experimental_tag_heat_color'
  | 'experimental_tag_heat_intensity'
  | 'experimental_url_privacy_enabled'
  | 'experimental_url_privacy_effect'
  | 'experimental_url_privacy_strength'
  | 'experimental_hover_card_enabled'
  | 'experimental_hover_card_theme'
  | 'experimental_hover_card_effect'
  | 'experimental_hover_card_accent_color'
  | 'experimental_hover_card_intensity'
  | 'experimental_hover_card_size'
  | 'experimental_hover_card_delay'
  | 'experimental_hover_card_advanced_clicks'
  | 'experimental_hover_card_collector_clicks'
  | 'experimental_hover_card_secret_clicks'
  | 'experimental_hover_card_shuffle_enabled'
  | keyof MotionPreferences
>

export interface PublicSharePayload {
  profile: {
    username: string
    title: string | null
    description: string | null
    slug: string
  }
  preferences: PublicDisplayPreferences
  bookmarks: Bookmark[]
  tags: Array<Tag & { bookmark_count: number }>
  generated_at: string
}

export interface PublicSharePaginatedPayload {
  profile: {
    username: string
    title: string | null
    description: string | null
    slug: string
  }
  preferences: PublicDisplayPreferences
  bookmarks: Bookmark[]
  tags: Array<Tag & { bookmark_count: number }>
  meta: {
    page_size: number
    count: number
    next_cursor: string | null
    has_more: boolean
  }
}
