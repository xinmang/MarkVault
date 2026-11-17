export type PluginKind =
  | 'theme'
  | 'motion'
  | 'background'
  | 'page'
  | 'panel'
  | 'action'
  | 'provider'
  | 'agent'
  | 'tool'
  | 'mcp'
export interface PluginContribution {
  animation?: {
    target: 'cards' | 'buttons' | 'tags'
    effect: 'fade' | 'rise' | 'pulse'
    duration: number
  }
  id: string
  kind: PluginKind
  title: string
  entry?: string
  slot?: string
  tokens?: Record<string, string>
  inputSchema?: Record<string, unknown>
}
export const PLUGIN_CATEGORIES = [
  'appearance',
  'effects',
  'intelligence',
  'connections',
  'insights',
  'layouts',
  'other',
] as const
export type PluginCategory = (typeof PLUGIN_CATEGORIES)[number]
export interface PluginManifest {
  id: string
  version: string
  api: string
  name: string
  description?: string
  author: string
  /** 设置页与插件中心的功能分类；缺省时按贡献类型推断。 */
  category?: PluginCategory
  /** 展示用图标名（小写连字符），未知名称显示默认图标。 */
  icon?: string
  server?: string
  dependencies?: Record<string, string>
  permissions: string[]
  settings?: Record<string, unknown>
  contributes: PluginContribution[]
}
export interface PluginState {
  preferenceBound?: boolean
  lastError?: string
  manifest: PluginManifest
  origin: 'builtin' | 'official' | 'community'
  enabled: boolean
  disabled: boolean
  status: 'running' | 'disabled' | 'waiting' | 'pending-authorization' | 'unavailable' | 'failed'
  reason?: string
  config: Record<string, unknown>
  grants: string[]
  revision: string
  digest?: string
  previousVersion?: string
}
export interface PluginDirectory {
  defaultBookmarkImage?: string
  plugins: PluginState[]
  admin: boolean
  apiVersion: string
  runtimeAvailable: boolean
}
