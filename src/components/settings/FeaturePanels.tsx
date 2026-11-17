import { usePlugins } from '@/plugins/context'
import { ImageHostingSettings } from '@/plugins/ImageHostingSettings'
import { MCPConnections } from '@/plugins/MCPConnections'
import { PluginAdvancedSettings } from '@/plugins/PluginAdvancedSettings'
import { PluginModelSelector } from '@/plugins/PluginModelSelector'
import { AiSettingsTab } from './tabs/AiSettingsTab'

/** 这里的面板原先在各自的插件详情页，现在嵌在设置页对应功能的条目里。 */
function useFeature(id: string) {
  return usePlugins().directory?.plugins.find((plugin) => plugin.manifest.id === 'markvault.' + id)
}

/** 模型供应商：AI 服务配置；装有第三方模型供应商时，另外提供选择当前供应商的下拉框。 */
export function ModelProviderPanel() {
  const { directory } = usePlugins()
  const plugin = useFeature('models')
  const thirdParty = directory?.plugins.some(
    (item) =>
      item.origin !== 'builtin' &&
      item.status === 'running' &&
      item.manifest.contributes.some((contribution) => contribution.kind === 'provider')
  )
  return (
    <div className="space-y-5">
      {plugin && (thirdParty || Boolean(plugin.config.providerId)) && (
        <PluginModelSelector plugin={plugin} />
      )}
      <AiSettingsTab />
    </div>
  )
}

/** 外部 MCP：连接管理，以及凭据和对外工具授权。 */
export function McpClientPanel() {
  const plugin = useFeature('mcp-client')
  if (!plugin) return null
  return (
    <div className="space-y-5">
      <MCPConnections />
      <PluginAdvancedSettings plugin={plugin} />
    </div>
  )
}

/** 图床：保存后修订号变化，按新配置重新挂载表单。 */
export function ImageHostingPanel() {
  const plugin = useFeature('image-hosting')
  return plugin ? <ImageHostingSettings key={plugin.revision} plugin={plugin} /> : null
}
