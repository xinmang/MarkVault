/** 液态玻璃主题的可调选项，对应 plugins/builtins.go 里 markvault.liquid-glass 的设置结构。 */
export interface LiquidGlassConfig {
  /** 指针水滴：靠近按钮时被吸附并与按钮融合 */
  droplet: boolean
  /** 玻璃上的高光随指针位置移动 */
  highlight: boolean
  /** 磨砂强度：玻璃背后内容的模糊半径，像素 */
  frost: number
  /** 融合范围，百分比：水滴与按钮开始拉丝融合的距离 */
  fusion: number
}

export const LIQUID_GLASS_FROST_RANGE = { min: 4, max: 40 } as const
export const LIQUID_GLASS_FUSION_RANGE = { min: 40, max: 160 } as const

export const DEFAULT_LIQUID_GLASS_CONFIG: LiquidGlassConfig = {
  droplet: true,
  highlight: true,
  frost: 18,
  fusion: 100,
}

const clampInteger = (value: unknown, range: { min: number; max: number }, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.min(range.max, Math.max(range.min, value)))
    : fallback

/** 把插件保存的配置整理成完整选项；缺失或类型不对的字段回到默认值，数值收进允许范围。 */
export function resolveLiquidGlassConfig(raw?: Record<string, unknown> | null): LiquidGlassConfig {
  const config = { ...DEFAULT_LIQUID_GLASS_CONFIG }
  if (!raw) return config
  for (const key of ['droplet', 'highlight'] as const)
    if (typeof raw[key] === 'boolean') config[key] = raw[key]
  config.frost = clampInteger(raw.frost, LIQUID_GLASS_FROST_RANGE, config.frost)
  config.fusion = clampInteger(raw.fusion, LIQUID_GLASS_FUSION_RANGE, config.fusion)
  return config
}

/** 融合范围为 100% 时的融合半径与吸附距离，像素。 */
const BASE_FUSION_RADIUS = 30
const BASE_REACH = 64

/** 融合半径：两个形状的间隙小于它的一半时连在一起。 */
export function fusionRadius(fusion: number): number {
  return (BASE_FUSION_RADIUS * fusion) / 100
}

/** 吸附距离：指针离按钮边缘不到这个距离时，水滴开始被吸过去。 */
export function fusionReach(fusion: number): number {
  return (BASE_REACH * fusion) / 100
}

/**
 * 参与融合的元素：按钮、标签和导航项。主题样式把它们画成玻璃，
 * 融合图层按同一份名单寻找指针附近的形状。
 */
export const GLASS_TARGETS = [
  '.btn',
  '.tag-item',
  '.pshell-pill',
  '.pshell-tabs__button',
  '.pshell-strip__tab',
  '.settings-nav-item',
  '.color-theme-trigger',
  '[data-liquid-glass]',
].join(', ')
