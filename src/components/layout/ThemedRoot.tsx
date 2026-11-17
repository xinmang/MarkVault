import type React from 'react'
import { useThemeStore } from '@/stores/themeStore'
import { OceanBackground } from '@/components/common/OceanBackground'
import { resolveOceanBackground } from '@/lib/ocean-background'
import { useExperimentalFeatures } from '@/contexts/ExperimentalFeaturesContext'
import { useBuiltinPlugin } from '@/plugins/context'
import { PluginSlot } from '@/plugins/PluginSlot'
import { useEffectiveColorTheme } from '@/hooks/useEffectiveColorTheme'

export function ThemedRoot({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  const { theme, oceanBackground } = useThemeStore()
  const colorTheme = useEffectiveColorTheme()
  const features = useExperimentalFeatures()
  const oceanEnabled = useBuiltinPlugin('ocean')
  const mode = oceanEnabled
    ? (features.oceanBackground ?? resolveOceanBackground(oceanBackground))
    : 'off'
  const hasOcean = mode !== 'off'

  return (
    <div
      className={`themed-root min-h-screen ${hasOcean ? 'themed-root--ocean' : ''} ${className}`.trim()}
      style={{ backgroundColor: 'var(--background)' }}
      data-theme={theme}
      data-color-theme={colorTheme}
    >
      <OceanBackground mode={mode} />
      <PluginSlot name="background" />
      {children}
    </div>
  )
}
