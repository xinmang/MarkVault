import { createContext, useContext } from 'react'
import type { PluginDirectory } from '@shared/plugin-types'
import { isPluginRunning } from './navigation'

export const PluginContext = createContext<{
  directory?: PluginDirectory
  safe: boolean
  ready: boolean
  refresh: () => Promise<unknown>
}>({ safe: false, ready: false, refresh: async () => undefined })
export const usePlugins = () => useContext(PluginContext)

/** 功能入口必须等待目录就绪并确认运行状态，不能沿用视觉插件的加载兜底。 */
export function useBuiltinPluginRunning(id: string): boolean {
  const { directory, safe, ready } = usePlugins()
  return (
    !safe &&
    ready &&
    isPluginRunning(directory?.plugins.find((item) => item.manifest.id === 'markvault.' + id))
  )
}
export function useBuiltinPlugin(id: string): boolean {
  const { directory, safe, ready } = usePlugins()
  if (safe) return false
  // 未加载账号插件目录时保持既有视觉效果；匿名分享不执行第三方插件。
  if (!ready || !directory) return true
  const item = directory.plugins.find((item) => item.manifest.id === 'markvault.' + id)
  return Boolean(item && (item.preferenceBound ? !item.disabled : item.status === 'running'))
}
