import { useLayoutEffect } from 'react'
import { useThemeStore } from '@/stores/themeStore'
import { useEffectiveColorTheme } from '@/hooks/useEffectiveColorTheme'

/** 页面根节点只在这里同步明暗与生效配色，避免切换明暗时绕过插件状态。 */
export function DocumentTheme() {
  const theme = useThemeStore((state) => state.theme)
  const colorTheme = useEffectiveColorTheme()
  useLayoutEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', theme)
    root.setAttribute('data-color-theme', colorTheme)
  }, [theme, colorTheme])
  return null
}
