/** ASCII 终端主题的可调选项，对应 plugins/builtins.go 里 markvault.ascii 的设置结构。 */
export type AsciiBackgroundMode = 'field' | 'rain' | 'off'

export interface AsciiConfig {
  /** 进入页面时播放一次启动序列（每个浏览器会话一次） */
  boot: boolean
  /** 字符背景：字符场、字符雨或关闭 */
  background: AsciiBackgroundMode
  /** 叠加扫描线 */
  scanlines: boolean
  /** 切换页面与悬停标题时的故障闪烁 */
  glitch: boolean
  /** 背景字符密度，百分比 */
  density: number
}

export const ASCII_DENSITY_RANGE = { min: 40, max: 160 } as const

export const DEFAULT_ASCII_CONFIG: AsciiConfig = {
  boot: true,
  background: 'field',
  scanlines: true,
  glitch: true,
  density: 100,
}

const BACKGROUNDS: readonly AsciiBackgroundMode[] = ['field', 'rain', 'off']

/** 把插件保存的配置整理成完整选项；缺失或类型不对的字段回到默认值，数值收进允许范围。 */
export function resolveAsciiConfig(raw?: Record<string, unknown> | null): AsciiConfig {
  const config = { ...DEFAULT_ASCII_CONFIG }
  if (!raw) return config
  for (const key of ['boot', 'scanlines', 'glitch'] as const)
    if (typeof raw[key] === 'boolean') config[key] = raw[key]
  if (BACKGROUNDS.includes(raw.background as AsciiBackgroundMode))
    config.background = raw.background as AsciiBackgroundMode
  if (typeof raw.density === 'number' && Number.isFinite(raw.density))
    config.density = Math.round(
      Math.min(ASCII_DENSITY_RANGE.max, Math.max(ASCII_DENSITY_RANGE.min, raw.density))
    )
  return config
}

export const ASCII_BOOT_SESSION_KEY = 'markvault:ascii-boot'
