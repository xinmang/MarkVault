import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Puzzle } from 'lucide-react'
import type { PluginState } from '@shared/plugin-types'
import { apiClient } from '@/lib/api-client'
import { usePlugins } from '@/plugins/context'
import { PluginIcon } from '@/plugins/icons'
import { localizedText, pluginDisplayName, pluginShortId } from '@/plugins/localize'

/**
 * 设置页里的自定义插件入口：列出已安装的第三方插件，安装、授权和配置在自定义插件页完成。
 * 管理员另外可以在这里对内置功能做全实例停用。
 */
export function CustomPluginsSection() {
  const { t, i18n } = useTranslation('plugins')
  const { directory, safe } = usePlugins()
  const query = safe ? '?safe=1' : ''
  const custom = directory?.plugins.filter((plugin) => plugin.origin !== 'builtin') ?? []
  return (
    <div className="space-y-6">
      <section className="settings-related-plugins" aria-label={t('custom.installed')}>
        <div className="settings-plugin-heading">
          <h2 className="text-sm font-semibold inline-flex items-center gap-2">
            <Puzzle size={14} aria-hidden="true" />
            {t('custom.installed')}
          </h2>
          <Link className="settings-plugin-center btn btn-sm btn-secondary" to={'/plugins' + query}>
            {t('custom.manage')}
          </Link>
        </div>
        <p className="settings-plugin-save-hint">{t('custom.hint')}</p>
        {!directory ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t('loading')}
          </p>
        ) : custom.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('custom.none')}</p>
        ) : (
          <div className="settings-plugin-list">
            {custom.map((plugin) => (
              <div
                key={plugin.manifest.id}
                className="settings-plugin-entry"
                data-plugin-id={plugin.manifest.id}
                data-enabled={plugin.enabled && !plugin.disabled}
              >
                <div className="settings-plugin-row">
                  <span className="settings-plugin-icon">
                    <PluginIcon plugin={plugin} size={16} />
                  </span>
                  <div className="settings-plugin-copy">
                    <Link
                      className="settings-plugin-name"
                      to={'/plugins/' + plugin.manifest.id + query}
                    >
                      {pluginDisplayName(plugin, i18n.language)}
                    </Link>
                    {plugin.manifest.description && (
                      <p className="settings-plugin-summary">
                        {localizedText(plugin.manifest.description, i18n.language)}
                      </p>
                    )}
                  </div>
                  <div className="settings-plugin-state">
                    <span
                      className="settings-plugin-status"
                      data-running={plugin.status === 'running'}
                      data-status={plugin.status}
                    >
                      {t('status.' + plugin.status)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      {directory?.admin && <InstanceFeatures plugins={directory.plugins} />}
    </div>
  )
}

/** 管理员对内置功能的全实例停用与恢复，默认收起。 */
function InstanceFeatures({ plugins }: { plugins: PluginState[] }) {
  const { t, i18n } = useTranslation('plugins')
  const { refresh } = usePlugins()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const change = async (plugin: PluginState) => {
    setBusyId(plugin.manifest.id)
    setError('')
    try {
      await apiClient.post(
        '/plugin-admin/' + plugin.manifest.id + '/' + (plugin.disabled ? 'allow' : 'disable')
      )
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('error'))
    } finally {
      setBusyId(null)
    }
  }
  return (
    <details className="settings-instance-features">
      <summary>{t('instance.title')}</summary>
      <p className="settings-plugin-save-hint">{t('instance.hint')}</p>
      {error && (
        <p role="alert" className="text-sm text-error mb-2">
          {error}
        </p>
      )}
      <div className="settings-plugin-list">
        {plugins
          .filter((plugin) => plugin.origin === 'builtin')
          .map((plugin) => (
            <div
              key={plugin.manifest.id}
              className="settings-plugin-entry"
              data-plugin-id={plugin.manifest.id}
              data-enabled={!plugin.disabled}
            >
              <div className="settings-plugin-row">
                <span className="settings-plugin-icon">
                  <PluginIcon plugin={plugin} size={16} />
                </span>
                <div className="settings-plugin-copy">
                  <span className="settings-plugin-name">
                    {pluginDisplayName(plugin, i18n.language)}
                  </span>
                  <p className="settings-plugin-summary">
                    {t('summary.' + pluginShortId(plugin.manifest.id), { defaultValue: '' })}
                  </p>
                </div>
                <div className="settings-plugin-state">
                  {plugin.disabled && (
                    <span className="settings-plugin-status" data-status="disabled">
                      {t('instanceDisabled')}
                    </span>
                  )}
                  <button
                    type="button"
                    className="settings-plugin-action"
                    disabled={Boolean(busyId)}
                    onClick={() => void change(plugin)}
                  >
                    {t(plugin.disabled ? 'allowInstance' : 'disableInstance')}
                  </button>
                </div>
              </div>
            </div>
          ))}
      </div>
    </details>
  )
}
