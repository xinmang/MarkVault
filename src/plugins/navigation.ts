import { PLUGIN_CATEGORIES, type PluginCategory, type PluginState } from '@shared/plugin-types'

/** 设置页与自定义插件页共用同一份功能归属，避免分类与链接漂移。 */
export { PLUGIN_CATEGORIES }
export type { PluginCategory }

/**
 * 内置功能在设置页的落点：所属分区和功能页面。
 * picker 表示由专用选择器管理（界面主题、页面版式），不作为带开关的条目列出。
 * 分类优先取清单里的 category（由 plugins/builtins.go 登记），这里的 category 只是清单缺省时的兜底。
 */
const builtinNavigation: Record<
  string,
  { category: PluginCategory; section: string; page?: string; picker?: true }
> = {
  classic: { category: 'appearance', section: 'theme', picker: true },
  vibehub: { category: 'appearance', section: 'theme', picker: true },
  'uiux-pro': { category: 'appearance', section: 'theme', picker: true },
  ascii: { category: 'appearance', section: 'theme', picker: true },
  'liquid-glass': { category: 'appearance', section: 'theme', picker: true },
  palettes: { category: 'appearance', section: 'theme' },
  'animated-icons': { category: 'appearance', section: 'theme' },
  motion: { category: 'effects', section: 'motion' },
  ocean: { category: 'effects', section: 'motion' },
  cursor: { category: 'effects', section: 'motion' },
  'theme-transition': { category: 'effects', section: 'motion' },
  'tag-heat': { category: 'effects', section: 'enhancements' },
  'url-privacy': { category: 'effects', section: 'enhancements' },
  'hover-card': { category: 'effects', section: 'enhancements' },
  agent: { category: 'intelligence', section: 'ai', page: '/agent/chat' },
  models: { category: 'intelligence', section: 'ai' },
  tools: { category: 'intelligence', section: 'ai' },
  'agent-api': { category: 'connections', section: 'api' },
  'mcp-server': { category: 'connections', section: 'api' },
  'mcp-client': { category: 'connections', section: 'connections' },
  'image-hosting': { category: 'connections', section: 'connections' },
  'browser-extension': { category: 'connections', section: 'connections', page: '/extension' },
  statistics: { category: 'insights', section: 'statistics', page: '/statistics' },
  'page-speed': { category: 'insights', section: 'statistics' },
  passkey: { category: 'connections', section: 'basic' },
  'view-gallery': { category: 'layouts', section: 'layouts', page: '/' },
  'view-timeline': { category: 'layouts', section: 'layouts', page: '/' },
  'view-domains': { category: 'layouts', section: 'layouts', page: '/' },
  'view-focus': { category: 'layouts', section: 'layouts', page: '/' },
  'tag-cloud': { category: 'layouts', section: 'layouts', page: '/' },
  'tag-bars': { category: 'layouts', section: 'layouts', page: '/' },
  'tab-board': { category: 'layouts', section: 'layouts', page: '/tab' },
  'tab-compact': { category: 'layouts', section: 'layouts', page: '/tab' },
  'home-topbar': { category: 'appearance', section: 'theme', page: '/', picker: true },
  'home-launchpad': { category: 'appearance', section: 'theme', page: '/', picker: true },
  'home-reader': { category: 'appearance', section: 'theme', page: '/', picker: true },
  'home-tagboard': { category: 'appearance', section: 'theme', page: '/', picker: true },
  'home-canvas': { category: 'appearance', section: 'theme', page: '/', picker: true },
  'tabs-tabbed': { category: 'appearance', section: 'theme', page: '/tab', picker: true },
  'tabs-wall': { category: 'appearance', section: 'theme', page: '/tab', picker: true },
  'tabs-timeline': { category: 'appearance', section: 'theme', page: '/tab', picker: true },
  'tabs-canvas': { category: 'appearance', section: 'theme', page: '/tab', picker: true },
}

export function getBuiltinNavigation(id: string) {
  return id.startsWith('markvault.') ? builtinNavigation[id.slice('markvault.'.length)] : undefined
}

const BUILTIN_ORDER = Object.keys(builtinNavigation)

/** 内置功能在上表中的登记位置，设置页按它排列条目；未登记的排在最后。 */
export function builtinOrder(id: string): number {
  const index = BUILTIN_ORDER.indexOf(id.slice('markvault.'.length))
  return index < 0 ? BUILTIN_ORDER.length : index
}

/** 内置功能在设置页的地址：定位到所属分区，有独立条目的功能同时展开它的设置。 */
export function featureSettingsPath(id: string, safe = false): string {
  const navigation = getBuiltinNavigation(id)
  const params = new URLSearchParams()
  if (navigation) params.set('section', navigation.section)
  if (navigation && !navigation.picker) params.set('plugin', id)
  if (safe) params.set('safe', '1')
  const query = params.toString()
  return '/settings/general' + (query ? '?' + query : '')
}

export function getPluginCategory(plugin: PluginState): PluginCategory {
  const declared = plugin.manifest.category
  if (declared && PLUGIN_CATEGORIES.includes(declared)) return declared
  const builtin = plugin.origin === 'builtin' ? getBuiltinNavigation(plugin.manifest.id) : undefined
  if (builtin) return builtin.category
  const kinds = plugin.manifest.contributes.map((item) => item.kind)
  if (kinds.includes('theme')) return 'appearance'
  if (kinds.includes('motion') || kinds.includes('background')) return 'effects'
  if (kinds.includes('agent') || kinds.includes('provider') || kinds.includes('tool'))
    return 'intelligence'
  if (kinds.includes('mcp')) return 'connections'
  if (plugin.manifest.contributes.some((item) => item.slot === 'statistics')) return 'insights'
  return 'other'
}

export function isPluginRunning(plugin?: PluginState): boolean {
  return Boolean(plugin && plugin.enabled && !plugin.disabled && plugin.status === 'running')
}
