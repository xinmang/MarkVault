import { useThemeStore, type ColorTheme } from '@/stores/themeStore'
import { useBuiltinPlugin } from '@/plugins/context'

/** 停用时仅回退实际显示颜色，保留浏览器中已选择的配色供重新启用恢复。 */
export function useEffectiveColorTheme(): ColorTheme {
  const color = useThemeStore((state) => state.colorTheme)
  return useBuiltinPlugin('palettes') ? color : 'default'
}
