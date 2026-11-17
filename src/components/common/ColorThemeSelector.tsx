import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useThemeStore, type ColorTheme } from '@/stores/themeStore'
import { useBuiltinPlugin } from '@/plugins/context'
import { COLOR_THEME_OPTIONS } from '@/lib/color-themes'

const DEFAULT_COLOR_THEME_OPTION: { id: ColorTheme; swatch: string } = {
  id: 'default',
  swatch: '#52525b',
}

export function ColorThemeSelector() {
  const { t } = useTranslation('common')
  const enabled = useBuiltinPlugin('palettes')
  const { colorTheme, setColorTheme } = useThemeStore()
  const [isOpen, setIsOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const currentTheme =
    COLOR_THEME_OPTIONS.find((option) => option.id === colorTheme) ?? DEFAULT_COLOR_THEME_OPTION
  const currentLabel = t(`nav.colorThemes.${currentTheme.id}`)

  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
        triggerRef.current?.focus()
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const handleSelect = (theme: ColorTheme) => {
    setColorTheme(theme)
    setIsOpen(false)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  if (!enabled) return null
  return (
    <div ref={pickerRef} className="color-theme-picker">
      <button
        ref={triggerRef}
        type="button"
        className="color-theme-trigger"
        onClick={() => setIsOpen((open) => !open)}
        aria-label={t('nav.currentColorTheme', { theme: currentLabel })}
        aria-expanded={isOpen}
        aria-controls={menuId}
        aria-haspopup="menu"
        data-open={isOpen ? 'true' : undefined}
      >
        <span
          className="color-theme-trigger__swatch"
          style={{ backgroundColor: currentTheme.swatch }}
          aria-hidden="true"
        />
      </button>

      {isOpen && (
        <div
          id={menuId}
          className="color-theme-menu"
          role="menu"
          aria-label={t('nav.colorThemeLabel')}
        >
          <div className="color-theme-menu__options">
            {COLOR_THEME_OPTIONS.map((option) => {
              const isSelected = option.id === colorTheme
              return (
                <button
                  key={option.id}
                  type="button"
                  className="color-theme-option"
                  data-selected={isSelected ? 'true' : undefined}
                  onClick={() => handleSelect(option.id)}
                  role="menuitemradio"
                  aria-checked={isSelected}
                  aria-label={t(`nav.colorThemes.${option.id}`)}
                >
                  <span
                    className="color-theme-option__swatch"
                    style={{ backgroundColor: option.swatch }}
                    aria-hidden="true"
                  />
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
