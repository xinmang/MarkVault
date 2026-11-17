import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Infinity as InfinityIcon } from 'lucide-react'
import { SettingsSection } from '@/components/settings/SettingsSection'
import { Toggle } from '@/components/common/Toggle'
import { usePlugins } from '@/plugins/context'
import { pluginAPI } from '@/plugins/api'
import { SHELL_PAGES, shellPluginId, usePageShell, type ShellPage } from '@/plugins/shells'
import './style.css'

const CANVAS = 'canvas'

/**
 * 设置页「界面与配色」里的无限画布开关：首页和标签页组各一个。
 * 无限画布是一种页面版式，打开即启用对应插件并切换到画布，关闭则回到默认版式并停用插件；
 * 与下方页面版式选择器里的「无限画布」是同一个状态。
 */
export function CanvasModeSettings() {
  const { t } = useTranslation('plugins')
  const { safe } = usePlugins()
  return (
    <SettingsSection icon={InfinityIcon} title={t('canvas.settings.title')}>
      <p className="pcanvas-settings__hint">{t('canvas.settings.hint')}</p>
      {safe && (
        <p role="status" className="pcanvas-settings__hint">
          {t('shells.picker.safe')}
        </p>
      )}
      {SHELL_PAGES.map((page) => (
        <CanvasModeToggle key={page} page={page} />
      ))}
    </SettingsSection>
  )
}

function CanvasModeToggle({ page }: { page: ShellPage }) {
  const { t } = useTranslation('plugins')
  const { directory, refresh, safe } = usePlugins()
  const shell = usePageShell(page)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const plugin = directory?.plugins.find(
    (item) => item.manifest.id === 'markvault.' + shellPluginId(page, CANVAS)
  )
  // 安全模式下页面实际使用默认版式，这里仍显示已保存的选择
  const checked = safe
    ? shell.stored === CANVAS && Boolean(plugin?.enabled)
    : shell.active === CANVAS
  const change = async (enabled: boolean) => {
    if (!plugin) return
    setError('')
    if (plugin.enabled !== enabled) {
      setBusy(true)
      try {
        await pluginAPI.save(plugin, enabled, plugin.config, plugin.grants)
        await refresh()
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t('error'))
        return
      } finally {
        setBusy(false)
      }
    }
    shell.select(enabled ? CANVAS : 'default')
  }
  const name = t(`canvas.settings.${page}.name`)
  return (
    <div className="pcanvas-settings__row" data-canvas-page={page}>
      <div className="pcanvas-settings__copy">
        <div className="pcanvas-settings__name">{name}</div>
        <div className="pcanvas-settings__description">
          {t(`canvas.settings.${page}.description`)}
          {plugin?.disabled && ' · ' + t('shells.picker.unavailable')}
        </div>
        {error && (
          <p role="alert" className="pcanvas-settings__error">
            {error}
          </p>
        )}
      </div>
      <Toggle
        checked={checked}
        disabled={busy || safe || !plugin || plugin.disabled}
        onChange={(enabled) => void change(enabled)}
        ariaLabel={t('canvas.settings.toggle', { name })}
      />
    </div>
  )
}
