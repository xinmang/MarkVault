import { useTranslation } from 'react-i18next'
import { useThemeStore } from '@/stores/themeStore'
import { COLOR_THEME_OPTIONS } from '@/lib/color-themes'

/** 配色属于浏览器本地偏好，与明暗切换分别保存。 */
export function PalettePluginSettings() {
  const { t } = useTranslation('plugins')
  const { colorTheme, setColorTheme } = useThemeStore()
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('paletteSettingsHint')}</p>
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label={t('common:nav.colorThemeLabel')}
      >
        {COLOR_THEME_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            className="motion-option inline-flex items-center gap-2 min-h-9 rounded-lg border px-3 text-sm"
            aria-pressed={colorTheme === option.id}
            onClick={() => setColorTheme(option.id)}
          >
            <span
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: option.swatch }}
              aria-hidden="true"
            />
            {t('common:nav.colorThemes.' + option.id)}
          </button>
        ))}
      </div>
    </div>
  )
}
