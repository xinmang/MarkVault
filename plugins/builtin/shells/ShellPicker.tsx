import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, LayoutTemplate } from 'lucide-react'
import { SettingsSection } from '@/components/settings/SettingsSection'
import { usePlugins } from '@/plugins/context'
import { pluginAPI } from '@/plugins/api'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import {
  DESKTOP_ONLY_SHELLS,
  SHELL_PAGES,
  shellNames,
  shellPluginId,
  usePageShell,
  type ShellPage,
} from '@/plugins/shells'
import { SHELL_ICONS } from './registry'
import './style.css'

/**
 * 设置页「主题外观」里的版式选择：每个页面一组单选卡片。
 * 选中某个版式时顺带开启它，不需要另外的开关。
 */
export function ShellPicker() {
  const { t } = useTranslation('plugins')
  const { safe } = usePlugins()
  return (
    <SettingsSection icon={LayoutTemplate} title={t('shells.picker.title')}>
      <p className="pshell-picker-hint">{t('shells.picker.hint')}</p>
      {safe && (
        <p role="status" className="pshell-picker-hint">
          {t('shells.picker.safe')}
        </p>
      )}
      {SHELL_PAGES.map((page) => (
        <ShellPickerGroup key={page} page={page} />
      ))}
    </SettingsSection>
  )
}

function ShellPickerGroup({ page }: { page: ShellPage }) {
  const { t } = useTranslation('plugins')
  const { directory, refresh, safe } = usePlugins()
  const shell = usePageShell(page)
  const isDesktop = useIsDesktop()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pluginOf = (name: string) =>
    directory?.plugins.find((item) => item.manifest.id === 'markvault.' + shellPluginId(page, name))
  const choose = async (name: string) => {
    setError('')
    const plugin = name === 'default' ? undefined : pluginOf(name)
    if (name !== 'default' && !plugin) return
    if (plugin && !plugin.enabled) {
      setBusy(true)
      try {
        await pluginAPI.save(plugin, true, plugin.config, plugin.grants)
        await refresh()
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t('error'))
        return
      } finally {
        setBusy(false)
      }
    }
    shell.select(name)
  }
  // 安全模式下页面实际使用默认版式，但这里仍显示已保存的选择，避免误以为选择丢失
  const selected = safe ? (shell.stored ?? 'default') : shell.active
  return (
    <fieldset className="pshell-picker-group" disabled={busy || safe || !directory}>
      <legend className="pshell-picker-legend">{t(`shells.${page}.label`)}</legend>
      {error && (
        <p role="alert" className="pshell-picker-error">
          {error}
        </p>
      )}
      <div className="interface-theme-grid pshell-picker-grid">
        {['default', ...shellNames(page)].map((name) => {
          const Icon = SHELL_ICONS[page][name]!
          const unavailable = name !== 'default' && (pluginOf(name)?.disabled ?? !pluginOf(name))
          const checked = selected === name
          // 需要桌面宽度的版式在窄窗口下由页面退回默认骨架，这里说明原因，避免看起来像选择没生效
          const narrow =
            checked && !isDesktop && DESKTOP_ONLY_SHELLS.includes(shellPluginId(page, name))
          return (
            <label
              key={name}
              className={
                'interface-theme-card' +
                (checked ? ' interface-theme-card--selected' : '') +
                (unavailable ? ' pshell-picker-card--unavailable' : '')
              }
            >
              <input
                type="radio"
                name={'page-shell-' + page}
                value={name}
                checked={checked}
                disabled={unavailable}
                onChange={() => void choose(name)}
                className="sr-only"
              />
              <span className="interface-theme-card__body">
                <span className="interface-theme-card__heading">
                  <span className="interface-theme-card__title-wrap">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    <span className="interface-theme-card__title">
                      {t(`shells.${page}.${name}.name`)}
                    </span>
                  </span>
                  {checked && (
                    <span className="interface-theme-card__selected">
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      {t('shells.picker.selected')}
                    </span>
                  )}
                </span>
                <span className="pshell-picker-description">
                  {t(`shells.${page}.${name}.description`)}
                  {unavailable && directory && ' · ' + t('shells.picker.unavailable')}
                  {narrow && ' · ' + t('shells.picker.narrow')}
                </span>
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
