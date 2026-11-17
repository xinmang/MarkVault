import type { ColorTheme } from '@/stores/themeStore'

/** 页头与插件配置共用配色选项，避免名称、色样和可选值不一致。 */
export const COLOR_THEME_OPTIONS: Array<{ id: ColorTheme; swatch: string }> = [
  { id: 'default', swatch: '#52525b' },
  { id: 'blue', swatch: '#1e40d8' },
  { id: 'green', swatch: '#15803d' },
  { id: 'orange', swatch: '#c2410c' },
  { id: 'violet', swatch: '#7c3aed' },
]
