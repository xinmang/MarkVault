import {
  Check,
  Droplets,
  Palette,
  PanelTop,
  Sparkles,
  SlidersHorizontal,
  Terminal,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SettingsSection } from '../SettingsSection'

export type InterfaceTheme =
  | 'default'
  | 'classic'
  | 'vibehub'
  | 'uiux-pro'
  | 'ascii'
  | 'liquid-glass'

interface ThemeSettingsTabProps {
  interfaceTheme: InterfaceTheme
  onInterfaceThemeChange: (theme: InterfaceTheme) => void
}

const THEME_OPTIONS: Array<{
  id: InterfaceTheme
  icon: typeof Palette
}> = [
  { id: 'default', icon: SlidersHorizontal },
  { id: 'classic', icon: PanelTop },
  { id: 'vibehub', icon: Sparkles },
  { id: 'uiux-pro', icon: Palette },
  { id: 'ascii', icon: Terminal },
  { id: 'liquid-glass', icon: Droplets },
]

function ClassicThemePreview() {
  return (
    <div className="interface-theme-preview interface-theme-preview--classic" aria-hidden="true">
      <div className="interface-theme-preview__topbar">
        <span className="interface-theme-preview__brand" />
        <span className="interface-theme-preview__control" />
        <span className="interface-theme-preview__control interface-theme-preview__control--muted" />
      </div>
      <div className="interface-theme-preview__classic-body">
        <span className="interface-theme-preview__sidebar" />
        <div className="interface-theme-preview__classic-content">
          <span className="interface-theme-preview__line interface-theme-preview__line--wide" />
          <div className="interface-theme-preview__classic-cards">
            <span />
            <span />
            <span />
          </div>
        </div>
      </div>
    </div>
  )
}

function VibeHubThemePreview() {
  return (
    <div className="interface-theme-preview interface-theme-preview--vibehub" aria-hidden="true">
      <div className="interface-theme-preview__vibe-rail">
        <span className="is-active" />
        <span />
        <span />
      </div>
      <div className="interface-theme-preview__vibe-workspace">
        <div className="interface-theme-preview__vibe-heading">
          <span />
          <i />
        </div>
        <div className="interface-theme-preview__vibe-cards">
          <span className="is-featured" />
          <span />
        </div>
      </div>
    </div>
  )
}

function UiUxProThemePreview() {
  return (
    <div className="uiux-pro-preview interface-theme-preview--uiux-pro" aria-hidden="true">
      <div className="uiux-pro-preview__rail">
        <span className="is-active" />
        <span />
        <span />
        <span />
      </div>
      <div className="uiux-pro-preview__workspace">
        <div className="uiux-pro-preview__toolbar">
          <span className="uiux-pro-preview__title" />
          <span className="uiux-pro-preview__action" />
        </div>
        <div className="uiux-pro-preview__cards">
          <div className="uiux-pro-preview__card is-featured">
            <span />
            <strong />
            <small />
          </div>
          <div className="uiux-pro-preview__card">
            <span />
            <strong />
            <small />
          </div>
          <div className="uiux-pro-preview__card">
            <span />
            <strong />
            <small />
          </div>
        </div>
      </div>
    </div>
  )
}

/** ASCII 终端主题的预览本身就是一幅字符画：字符边框、方括号按钮和提示符。 */
function AsciiThemePreview() {
  return (
    <pre className="ascii-theme-preview" aria-hidden="true">
      <b>{'> MARKVAULT_'}</b>
      {'\n'}
      <i>{'+----------+ +----------+'}</i>
      {'\n'}
      <i>{'| '}</i>
      {'··:-=+#▪'}
      <i>{' | | '}</i>
      {'▪#+=-:··'}
      <i>{' |'}</i>
      {'\n'}
      <i>{'| '}</i>
      <b>{'#docs   '}</b>
      <i>{' | | '}</i>
      <b>{'#tools  '}</b>
      <i>{' |'}</i>
      {'\n'}
      <i>{'+----------+ +----------+'}</i>
      {'\n'}
      <b>{'[ SAVE ]'}</b>
      {'  [ CANCEL ]  '}
      <b>{'[--#]'}</b>
    </pre>
  )
}

/**
 * 液态玻璃主题的预览：两块玻璃面板，下面两颗胶囊靠近、融合再分开。
 * 融合用 SVG 的融球滤镜实现（先模糊，再按透明度切出硬边），不需要脚本。
 */
function LiquidGlassThemePreview() {
  return (
    <div className="liquid-glass-preview" aria-hidden="true">
      <svg viewBox="0 0 220 136" preserveAspectRatio="xMidYMid slice">
        <defs>
          <filter id="liquid-glass-preview-goo" x="-20%" y="-60%" width="140%" height="220%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
            <feColorMatrix in="blur" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9" />
          </filter>
        </defs>
        <rect className="liquid-glass-preview__pane" x="12" y="10" width="196" height="22" rx="11" />
        <rect className="liquid-glass-preview__line" x="24" y="18" width="54" height="6" rx="3" />
        <rect className="liquid-glass-preview__pane" x="12" y="40" width="94" height="48" rx="12" />
        <rect className="liquid-glass-preview__pane" x="114" y="40" width="94" height="48" rx="12" />
        <rect className="liquid-glass-preview__line" x="24" y="52" width="46" height="6" rx="3" />
        <rect className="liquid-glass-preview__line" x="126" y="52" width="58" height="6" rx="3" />
        <g className="liquid-glass-preview__goo">
          <g filter="url(#liquid-glass-preview-goo)">
            <rect x="28" y="100" width="66" height="24" rx="12" />
            <rect
              className="liquid-glass-preview__drop"
              x="136"
              y="100"
              width="56"
              height="24"
              rx="12"
            />
          </g>
        </g>
      </svg>
    </div>
  )
}

function ThemePreview({ theme }: { theme: InterfaceTheme }) {
  if (theme === 'default')
    return (
      <div className="default-theme-preview" aria-hidden="true">
        <div className="default-theme-preview__nav">
          <i />
          <i />
          <i />
          <i />
        </div>
        <div className="default-theme-preview__rows">
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>
    )
  if (theme === 'vibehub') return <VibeHubThemePreview />
  if (theme === 'uiux-pro') return <UiUxProThemePreview />
  if (theme === 'ascii') return <AsciiThemePreview />
  if (theme === 'liquid-glass') return <LiquidGlassThemePreview />
  return <ClassicThemePreview />
}

export function ThemeSettingsTab({
  interfaceTheme,
  onInterfaceThemeChange,
}: ThemeSettingsTabProps) {
  const { t } = useTranslation('settings')

  return (
    <div className="space-y-6">
      <SettingsSection icon={Palette} title={t('themeSettings.title')}>
        <fieldset className="space-y-3">
          <legend className="sr-only">{t('themeSettings.label')}</legend>
          <div className="interface-theme-grid">
            {THEME_OPTIONS.map(({ id, icon: Icon }) => {
              const selected = interfaceTheme === id

              return (
                <label
                  key={id}
                  className={`interface-theme-card ${selected ? 'interface-theme-card--selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="interface-theme"
                    value={id}
                    checked={selected}
                    onChange={() => onInterfaceThemeChange(id)}
                    className="sr-only"
                  />
                  <span className="interface-theme-card__body">
                    <span className="interface-theme-card__heading">
                      <span className="interface-theme-card__title-wrap">
                        <Icon className="h-4 w-4" aria-hidden="true" />
                        <span className="interface-theme-card__title">
                          {t(`themeSettings.options.${id}.title`)}
                        </span>
                      </span>
                      {selected && (
                        <span className="interface-theme-card__selected">
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          {t('themeSettings.selected')}
                        </span>
                      )}
                    </span>
                    <span className="interface-theme-card__description">
                      {t(`themeSettings.options.${id}.description`)}
                    </span>
                    <span className="interface-theme-card__preview">
                      <ThemePreview theme={id} />
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
        </fieldset>
      </SettingsSection>
    </div>
  )
}
