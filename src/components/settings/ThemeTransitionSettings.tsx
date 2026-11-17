import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ThemeToggle } from '@/components/common/ThemeToggle'
import { useThemeStore } from '@/stores/themeStore'

export function ThemeTransitionSettings() {
  const { t } = useTranslation('plugins')
  const theme = useThemeStore((state) => state.theme)
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('themeTransitionHint')}</p>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm">
          {t(theme === 'light' ? 'currentLightMode' : 'currentDarkMode')}
        </span>
        <ThemeToggle />
        <Link
          className="btn btn-sm btn-secondary"
          to="/settings/general?section=theme&plugin=markvault.palettes"
        >
          {t('configurePalette')}
        </Link>
      </div>
    </div>
  )
}
