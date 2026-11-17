import type { SortOption } from '@/components/common/SortSelector'

export const STANDARD_VIEW_MODES = ['list', 'card', 'minimal', 'title'] as const
/** 不依赖布局插件的视图；公开分享页只在这个范围内切换。 */
export const CORE_VIEW_MODES = [...STANDARD_VIEW_MODES, 'collectible'] as const
/** 由布局插件提供的视图，对应内置插件 markvault.view-<模式>。 */
export const PLUGIN_VIEW_MODES = ['gallery', 'timeline', 'domains', 'focus'] as const
export const VIEW_MODES = [...CORE_VIEW_MODES, ...PLUGIN_VIEW_MODES] as const
export type ViewMode = typeof VIEW_MODES[number]
export type PluginViewMode = typeof PLUGIN_VIEW_MODES[number]

export function isPluginViewMode(mode: string): mode is PluginViewMode {
  return (PLUGIN_VIEW_MODES as readonly string[]).includes(mode)
}

export const CORE_TAG_LAYOUTS = ['grid', 'masonry'] as const
/** 由布局插件提供的标签布局，对应内置插件 markvault.tag-<布局>。 */
export const PLUGIN_TAG_LAYOUTS = ['cloud', 'bars'] as const
export const TAG_LAYOUTS = [...CORE_TAG_LAYOUTS, ...PLUGIN_TAG_LAYOUTS] as const
export type TagLayout = typeof TAG_LAYOUTS[number]
export type PluginTagLayout = typeof PLUGIN_TAG_LAYOUTS[number]

export const SORT_OPTIONS: SortOption[] = ['created', 'updated', 'pinned', 'popular']

export type VisibilityFilter = 'all' | 'public' | 'private'
export const VISIBILITY_FILTERS: VisibilityFilter[] = ['all', 'public', 'private']

export const VIEW_MODE_STORAGE_KEY = 'markvault:view_mode'
export const VIEW_MODE_UPDATED_AT_STORAGE_KEY = 'markvault:view_mode_updated_at'
