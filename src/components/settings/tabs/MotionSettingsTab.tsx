import { useTranslation } from 'react-i18next'

import { SettingsItem } from '../SettingsSection'

import {
  useExperimentalFeatures,
  type AppearancePreview,
} from '@/contexts/ExperimentalFeaturesContext'
import { useThemeStore } from '@/stores/themeStore'
import {
  OCEAN_BACKGROUND_MODES,
  OCEAN_BACKGROUND_SCOPES,
  effectiveOceanBackground,
  resolveOceanBackgroundScope,
} from '@/lib/ocean-background'

interface MotionSettingsTabProps {
  value: AppearancePreview
  onChange: (updates: Partial<AppearancePreview>) => void
}

function OptionGroup<T extends string>({
  label,
  options,
  value,
  render,
  onChange,
}: {
  label: string
  options: readonly T[]
  value: T
  render: (option: T) => string
  onChange: (option: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className="motion-option min-h-9 rounded-lg border px-3 text-sm"
        >
          {render(option)}
        </button>
      ))}
    </div>
  )
}

/** 海洋背景属于 ocean 插件，设置页由关联插件条目负责折叠和启停。 */
export function OceanBackgroundSettings({
  value,
  onChange,
}: Pick<MotionSettingsTabProps, 'value' | 'onChange'>) {
  const { t } = useTranslation('settings')
  const { motion } = useExperimentalFeatures()
  const { oceanBackground, setOceanBackground } = useThemeStore()
  const scope = resolveOceanBackgroundScope(value.ocean_background_scope)
  const mode = effectiveOceanBackground(value, oceanBackground)

  return (
    <div className="settings-plugin-inline-options space-y-3">
      <SettingsItem
        title={t('motion.ocean.scope')}
        description={t(`motion.ocean.scopeHint.${scope}`)}
      >
        <div className="mt-3">
          <OptionGroup
            label={t('motion.ocean.scope')}
            options={OCEAN_BACKGROUND_SCOPES}
            value={scope}
            render={(option) => t(`motion.ocean.scopes.${option}`)}
            onChange={(option) => onChange({ ocean_background_scope: option })}
          />
        </div>
      </SettingsItem>
      <SettingsItem title={t('motion.ocean.style')}>
        <div className="mt-3">
          <OptionGroup
            label={t('motion.ocean.style')}
            options={OCEAN_BACKGROUND_MODES}
            value={mode}
            render={(option) => t(`motion.ocean.options.${option}`)}
            onChange={(option) => {
              if (scope === 'browser') setOceanBackground(option)
              else onChange({ ocean_background: option })
            }}
          />
        </div>
      </SettingsItem>
      {mode !== 'off' && (!value.motion_enabled || motion.reducedMotion) && (
        <p className="text-xs text-muted-foreground">{t('motion.ocean.paused')}</p>
      )}
    </div>
  )
}

/** 动效插件自身的开关就是总开关，面板只解释效果与系统限制。 */
export function MotionPluginSettings() {
  const { t } = useTranslation('settings')
  const { motion } = useExperimentalFeatures()
  return (
    <div className="text-sm text-muted-foreground space-y-2">
      <p>{t('motion.enabledHint')}</p>
      {motion.reducedMotion && <p>{t('motion.reducedMotion')}</p>}
    </div>
  )
}
