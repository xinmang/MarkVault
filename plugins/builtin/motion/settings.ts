import type { CSSProperties } from 'react'
import type {
  MotionCardHover,
  MotionIntensity,
  MotionListEntrance,
  MotionPreferences,
} from '@/lib/types'

/** 与迁移 0121 的默认值保持一致 */
export const DEFAULT_MOTION_PREFERENCES: MotionPreferences = {
  motion_enabled: true,
  motion_speed: 100,
  motion_intensity: 'standard',
  motion_button_feedback: true,
  motion_card_hover: 'lift',
  motion_list_entrance: 'rise',
  motion_tag_linkage: true,
  motion_page_transition: true,
}

export const MOTION_PREFERENCE_KEYS = ['motion_enabled'] as const
export const MOTION_SPEED_MIN = 50
export const MOTION_SPEED_MAX = 200

export interface MotionSettings {
  enabled: boolean
  speed: number
  intensity: MotionIntensity
  buttonFeedback: boolean
  cardHover: MotionCardHover
  listEntrance: MotionListEntrance
  tagLinkage: boolean
  pageTransition: boolean
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** 只保留总开关，具体动效统一使用标准值，避免旧的隐藏单项设置继续影响体验。 */
export function resolveMotionSettings(
  preferences?: Partial<MotionPreferences> | null
): MotionSettings {
  const defaults = DEFAULT_MOTION_PREFERENCES
  return {
    enabled: flag(preferences?.motion_enabled, defaults.motion_enabled),
    speed: defaults.motion_speed,
    intensity: defaults.motion_intensity,
    buttonFeedback: defaults.motion_button_feedback,
    cardHover: defaults.motion_card_hover,
    listEntrance: defaults.motion_list_entrance,
    tagLinkage: defaults.motion_tag_linkage,
    pageTransition: defaults.motion_page_transition,
  }
}

/** 动画时长倍率：速度 200% 时时长减半，50% 时加倍 */
export function motionDurationScale(speed: number): number {
  const safe = Number.isFinite(speed)
    ? Math.min(MOTION_SPEED_MAX, Math.max(MOTION_SPEED_MIN, speed))
    : 100
  return Math.round((100 / safe) * 1000) / 1000
}

const INTENSITY_SCALE: Record<MotionIntensity, number> = {
  subtle: 0.6,
  standard: 1,
  lively: 1.6,
}

/** 位移、倾斜、缩放幅度倍率 */
export function motionMagnitude(intensity: MotionIntensity): number {
  return INTENSITY_SCALE[intensity] ?? 1
}

/**
 * 动效是否实际生效：总开关关闭或系统要求减少动态效果时一律停用。
 * 标签联动的高亮不依赖动画，仍按自身开关决定，只是不再带过渡。
 */
export function motionRootAttributes(
  settings: MotionSettings,
  reducedMotion: boolean
): Record<string, string> {
  const active = settings.enabled && !reducedMotion
  return {
    'data-motion': active ? 'on' : 'off',
    'data-motion-buttons': active && settings.buttonFeedback ? 'on' : 'off',
    'data-motion-card': active ? settings.cardHover : 'none',
    'data-motion-entrance': active ? settings.listEntrance : 'none',
    'data-motion-linkage': settings.enabled && settings.tagLinkage ? 'on' : 'off',
    'data-motion-page': active && settings.pageTransition ? 'on' : 'off',
  }
}

export function motionRootVariables(settings: MotionSettings): Record<string, string> {
  return {
    '--motion-speed': String(motionDurationScale(settings.speed)),
    '--motion-scale': String(motionMagnitude(settings.intensity)),
  }
}

export const MOTION_ROOT_ATTRIBUTE_NAMES = Object.keys(
  motionRootAttributes(resolveMotionSettings(), false)
)
export const MOTION_ROOT_VARIABLE_NAMES = Object.keys(motionRootVariables(resolveMotionSettings()))

/** 把动效设置写到 <html> 的 data-motion-* 属性与 CSS 变量上 */
export function applyMotionToRoot(
  root: HTMLElement,
  settings: MotionSettings,
  reducedMotion: boolean
): void {
  for (const [name, value] of Object.entries(motionRootAttributes(settings, reducedMotion))) {
    root.setAttribute(name, value)
  }
  for (const [name, value] of Object.entries(motionRootVariables(settings))) {
    root.style.setProperty(name, value)
  }
}

export function clearMotionFromRoot(root: HTMLElement): void {
  for (const name of MOTION_ROOT_ATTRIBUTE_NAMES) root.removeAttribute(name)
  for (const name of MOTION_ROOT_VARIABLE_NAMES) root.style.removeProperty(name)
}

/** 当前是否允许运行由脚本驱动的动效（涟漪、倾斜、页面淡入） */
export function isMotionActive(root: HTMLElement = document.documentElement): boolean {
  return root.getAttribute('data-motion') === 'on'
}

/** 列表项入场动画的错开序号，写在包裹元素上由 CSS 继承 */
export function motionIndexStyle(index: number): CSSProperties {
  return { '--motion-index': Math.max(0, Math.min(index, 12)) } as CSSProperties
}
