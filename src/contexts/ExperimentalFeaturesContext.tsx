import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type {
  ExperimentalHoverCardEffect,
  ExperimentalHoverCardTheme,
  ExperimentalTagHeatEffect,
  ExperimentalTagHeatStyle,
  ExperimentalUrlPrivacyEffect,
  DefaultBookmarkIcon,
  UserPreferences,
} from '@/lib/types'
import { BookmarkHoverCardProvider } from '@/components/bookmarks/shared/BookmarkHoverCard'
import { VibeHubCursor } from '@/components/common/VibeHubCursor'
import { MotionEffects } from '@/components/common/MotionEffects'
import { AsciiTheme } from '../../plugins/builtin/ascii/AsciiTheme'
import { LiquidGlass } from '../../plugins/builtin/liquid-glass/LiquidGlass'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useThemeStore } from '@/stores/themeStore'
import { useBuiltinPlugin } from '@/plugins/context'
import { effectiveOceanBackground, type OceanBackgroundMode } from '@/lib/ocean-background'
import {
  applyMotionToRoot,
  clearMotionFromRoot,
  resolveMotionSettings,
  type MotionSettings,
} from '@/lib/motion'

interface TagHeatFeature {
  enabled: boolean
  style: ExperimentalTagHeatStyle
  effect: ExperimentalTagHeatEffect
  color: string
  intensity: number
}

interface UrlPrivacyFeature {
  enabled: boolean
  effect: ExperimentalUrlPrivacyEffect
  strength: number
}

export interface HoverCardFeature {
  enabled: boolean
  theme: ExperimentalHoverCardTheme
  effect: ExperimentalHoverCardEffect
  accentColor: string
  intensity: number
  size: number
  delay: number
  advancedClicks: number
  collectorClicks: number
  secretClicks: number
  shuffleEnabled: boolean
}

export interface MotionFeature extends MotionSettings {
  /** 总开关开启且系统未要求减少动态效果 */
  active: boolean
  /** 系统开启了“减少动态效果” */
  reducedMotion: boolean
}

interface ExperimentalFeaturesValue {
  defaultBookmarkIcon: DefaultBookmarkIcon
  vibeHubTheme: {
    enabled: boolean
  }
  uiUxProTheme: {
    enabled: boolean
  }
  asciiTheme: {
    enabled: boolean
  }
  liquidGlassTheme: {
    enabled: boolean
  }
  tagHeat: TagHeatFeature
  urlPrivacy: UrlPrivacyFeature
  hoverCard: HoverCardFeature
  motion: MotionFeature
  /** 未处于账号偏好 Provider 中时为 null，由页面使用浏览器本地选择。 */
  oceanBackground: OceanBackgroundMode | null
}

const DEFAULT_VALUE: ExperimentalFeaturesValue = {
  defaultBookmarkIcon: 'orbital-spinner',
  vibeHubTheme: {
    enabled: false,
  },
  uiUxProTheme: {
    enabled: false,
  },
  asciiTheme: {
    enabled: false,
  },
  liquidGlassTheme: {
    enabled: false,
  },
  tagHeat: {
    enabled: false,
    style: 'fill',
    effect: 'auto',
    color: '#3b82f6',
    intensity: 65,
  },
  urlPrivacy: {
    enabled: false,
    effect: 'blur',
    strength: 6,
  },
  hoverCard: {
    enabled: false,
    theme: 'creature',
    effect: 'auto',
    accentColor: '#e11d48',
    intensity: 75,
    size: 100,
    delay: 450,
    advancedClicks: 5,
    collectorClicks: 20,
    secretClicks: 50,
    shuffleEnabled: false,
  },
  motion: { ...resolveMotionSettings(), active: false, reducedMotion: false },
  oceanBackground: null,
}

/** 写在 <html data-experimental-ui> 上的界面主题，同一时间只有一个生效。 */
const INTERFACE_THEMES = ['vibehub', 'uiux-pro', 'ascii', 'liquid-glass']

const ExperimentalFeaturesContext = createContext<ExperimentalFeaturesValue>(DEFAULT_VALUE)

export type AppearancePreview = Pick<
  UserPreferences,
  'motion_enabled' | 'ocean_background' | 'ocean_background_scope'
>
type AppearancePreviewSetter = (preview: Partial<AppearancePreview> | null) => void
const AppearancePreviewContext = createContext<AppearancePreviewSetter | null>(null)

interface ExperimentalFeaturesProviderProps {
  preferences?: Partial<UserPreferences>
  applyThemeToDocument?: boolean
  children: ReactNode
}

export function ExperimentalFeaturesProvider({
  preferences,
  applyThemeToDocument = false,
  children,
}: ExperimentalFeaturesProviderProps) {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const motionPlugin = useBuiltinPlugin('motion')
  const oceanPlugin = useBuiltinPlugin('ocean')
  const vibePlugin = useBuiltinPlugin('vibehub')
  const uiPlugin = useBuiltinPlugin('uiux-pro')
  const asciiPlugin = useBuiltinPlugin('ascii')
  const glassPlugin = useBuiltinPlugin('liquid-glass')
  const heatPlugin = useBuiltinPlugin('tag-heat')
  const privacyPlugin = useBuiltinPlugin('url-privacy')
  const hoverPlugin = useBuiltinPlugin('hover-card')
  const cursorPlugin = useBuiltinPlugin('cursor')
  const iconsPlugin = useBuiltinPlugin('animated-icons')
  const browserOcean = useThemeStore((state) => state.oceanBackground)
  // 动效与账号海洋设置共用草稿，离开设置页后恢复已保存的值。
  const [appearancePreview, setAppearancePreview] = useState<Partial<AppearancePreview> | null>(
    null
  )
  const motion = useMemo<MotionFeature>(() => {
    const settings = resolveMotionSettings({ ...preferences, ...appearancePreview })
    return { ...settings, enabled: settings.enabled && motionPlugin, active: settings.enabled && motionPlugin && !reducedMotion, reducedMotion }
  }, [preferences, appearancePreview, reducedMotion, motionPlugin])
  const oceanBackground = oceanPlugin ? effectiveOceanBackground(
    { ...preferences, ...appearancePreview },
    browserOcean
  ) : 'off'

  const value = useMemo<ExperimentalFeaturesValue>(
    () => ({
      defaultBookmarkIcon: iconsPlugin ? preferences?.default_bookmark_icon ?? 'orbital-spinner' : 'letter',
      vibeHubTheme: {
        enabled: vibePlugin && (preferences?.experimental_vibehub_theme_enabled ?? false),
      },
      uiUxProTheme: {
        enabled: uiPlugin && (preferences?.experimental_uiux_pro_theme_enabled ?? false),
      },
      asciiTheme: {
        enabled: asciiPlugin && (preferences?.experimental_ascii_theme_enabled ?? false),
      },
      liquidGlassTheme: {
        enabled:
          glassPlugin && (preferences?.experimental_liquid_glass_theme_enabled ?? false),
      },
      tagHeat: {
        enabled: heatPlugin && (preferences?.experimental_tag_heat_enabled ?? false),
        style: preferences?.experimental_tag_heat_style ?? 'fill',
        effect: preferences?.experimental_tag_heat_effect ?? 'auto',
        color: preferences?.experimental_tag_heat_color ?? '#3b82f6',
        intensity: preferences?.experimental_tag_heat_intensity ?? 65,
      },
      urlPrivacy: {
        enabled: privacyPlugin && (preferences?.experimental_url_privacy_enabled ?? false),
        effect: preferences?.experimental_url_privacy_effect ?? 'blur',
        strength: preferences?.experimental_url_privacy_strength ?? 6,
      },
      hoverCard: {
        enabled: hoverPlugin && (preferences?.experimental_hover_card_enabled ?? false),
        theme: preferences?.experimental_hover_card_theme ?? 'creature',
        effect: preferences?.experimental_hover_card_effect ?? 'auto',
        accentColor: preferences?.experimental_hover_card_accent_color ?? '#e11d48',
        intensity: preferences?.experimental_hover_card_intensity ?? 75,
        size: preferences?.experimental_hover_card_size ?? 100,
        delay: preferences?.experimental_hover_card_delay ?? 450,
        advancedClicks: preferences?.experimental_hover_card_advanced_clicks ?? 5,
        collectorClicks: preferences?.experimental_hover_card_collector_clicks ?? 20,
        secretClicks: preferences?.experimental_hover_card_secret_clicks ?? 50,
        shuffleEnabled: preferences?.experimental_hover_card_shuffle_enabled ?? false,
      },
      motion,
      oceanBackground,
    }),
    [preferences, motion, oceanBackground, iconsPlugin, vibePlugin, uiPlugin, asciiPlugin, glassPlugin, heatPlugin, privacyPlugin, hoverPlugin]
  )

  useEffect(() => {
    if (!applyThemeToDocument) return
    const root = document.documentElement
    applyMotionToRoot(root, motion, motion.reducedMotion)
  }, [applyThemeToDocument, motion])

  useEffect(() => {
    if (!applyThemeToDocument) return
    const root = document.documentElement
    return () => clearMotionFromRoot(root)
  }, [applyThemeToDocument])

  useEffect(() => {
    if (!applyThemeToDocument) return

    const root = document.documentElement
    const activeTheme = value.liquidGlassTheme.enabled
      ? 'liquid-glass'
      : value.asciiTheme.enabled
        ? 'ascii'
        : value.uiUxProTheme.enabled
          ? 'uiux-pro'
          : value.vibeHubTheme.enabled
            ? 'vibehub'
            : null

    if (activeTheme) {
      root.setAttribute('data-experimental-ui', activeTheme)
    } else if (INTERFACE_THEMES.includes(root.getAttribute('data-experimental-ui') ?? '')) {
      root.removeAttribute('data-experimental-ui')
    }

    return () => {
      if (INTERFACE_THEMES.includes(root.getAttribute('data-experimental-ui') ?? '')) {
        root.removeAttribute('data-experimental-ui')
      }
    }
  }, [
    applyThemeToDocument,
    value.liquidGlassTheme.enabled,
    value.asciiTheme.enabled,
    value.uiUxProTheme.enabled,
    value.vibeHubTheme.enabled,
  ])

  return (
    <ExperimentalFeaturesContext.Provider value={value}>
      <AppearancePreviewContext.Provider value={setAppearancePreview}>
        <BookmarkHoverCardProvider settings={value.hoverCard} urlPrivacy={value.urlPrivacy}>
          {children}
        </BookmarkHoverCardProvider>
      </AppearancePreviewContext.Provider>
      <VibeHubCursor
        enabled={
          cursorPlugin &&
          applyThemeToDocument &&
          value.vibeHubTheme.enabled &&
          !value.uiUxProTheme.enabled &&
          !value.asciiTheme.enabled &&
          !value.liquidGlassTheme.enabled
        }
      />
      <AsciiTheme
        enabled={
          applyThemeToDocument && value.asciiTheme.enabled && !value.liquidGlassTheme.enabled
        }
        animated={motion.active}
      />
      <LiquidGlass
        enabled={applyThemeToDocument && value.liquidGlassTheme.enabled}
        animated={motion.active}
      />
      <MotionEffects enabled={applyThemeToDocument && motion.active} />
    </ExperimentalFeaturesContext.Provider>
  )
}

// Provider 与 Hook 必须共享同一个 Context 实例。
// eslint-disable-next-line react-refresh/only-export-components
export function useExperimentalFeatures(): ExperimentalFeaturesValue {
  return useContext(ExperimentalFeaturesContext)
}

/**
 * 设置页实时预览动效与海洋样式，卸载或传入 null 时恢复已保存的设置。
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useAppearancePreview(preview: Partial<AppearancePreview> | null) {
  const setPreview = useContext(AppearancePreviewContext)
  const key = preview ? JSON.stringify(preview) : ''
  useEffect(() => {
    if (!setPreview) return
    setPreview(key ? (JSON.parse(key) as Partial<AppearancePreview>) : null)
  }, [key, setPreview])
  useEffect(() => {
    if (!setPreview) return
    return () => setPreview(null)
  }, [setPreview])
}
