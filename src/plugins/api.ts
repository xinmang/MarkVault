import { apiClient } from '@/lib/api-client'
import type { PluginDirectory, PluginState } from '@shared/plugin-types'

export const pluginAPI = {
  async list() {
    const result = await apiClient.get<PluginDirectory>('/plugins')
    if (!result.data) throw new Error('插件目录读取失败')
    return result.data
  },
  async save(
    plugin: PluginState,
    enabled: boolean,
    config: Record<string, unknown>,
    grants: string[]
  ) {
    if (!config || typeof config !== 'object' || Array.isArray(config))
      throw new Error('插件配置必须为 JSON 对象 / Configuration must be a JSON object')
    return apiClient.put<PluginState>(`/plugins/` + encodeURIComponent(plugin.manifest.id), {
      enabled,
      config,
      grants,
    })
  },
  async rpc(plugin: PluginState, method: string, args: Record<string, unknown> = {}) {
    const result = await apiClient.post<{ value: unknown }>(
      `/plugins/` + encodeURIComponent(plugin.manifest.id) + '/rpc',
      { method, args, revision: plugin.revision }
    )
    return result.data?.value
  },
  async asset(plugin: PluginState, entry: string) {
    const result = await apiClient.get<{ content: string; revision: string }>(
      `/plugins/` +
        encodeURIComponent(plugin.manifest.id) +
        '/assets/' +
        entry.split('/').map(encodeURIComponent).join('/')
    )
    if (!result.data || result.data.revision !== plugin.revision) throw new Error('插件版本已变化')
    return new TextDecoder().decode(
      Uint8Array.from(atob(result.data.content), (char) => char.charCodeAt(0))
    )
  },
}
