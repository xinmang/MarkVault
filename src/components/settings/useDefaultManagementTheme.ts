import { usePlugins } from '@/plugins/context'
import '@/styles/management.css'

/** 紧凑管理界面仅用于未启用界面主题插件的设置页与插件页。 */
export function useDefaultManagementTheme() {
  const { directory, ready, safe } = usePlugins()
  if (safe) return true
  if (!ready || !directory) return false
  return !directory.plugins.some(
    (plugin) =>
      plugin.status === 'running' &&
      ([
        'markvault.classic',
        'markvault.vibehub',
        'markvault.uiux-pro',
        'markvault.ascii',
        'markvault.liquid-glass',
      ].includes(plugin.manifest.id) ||
        (plugin.origin !== 'builtin' &&
          plugin.manifest.contributes.some((item) => item.kind === 'theme')))
  )
}
