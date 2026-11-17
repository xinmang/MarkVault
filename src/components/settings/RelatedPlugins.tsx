import { useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight, ChevronDown, SlidersHorizontal } from 'lucide-react'
import type { PluginState } from '@shared/plugin-types'
import { Toggle } from '@/components/common/Toggle'
import { usePlugins } from '@/plugins/context'
import { pluginAPI } from '@/plugins/api'
import { PluginIcon } from '@/plugins/icons'
import { localizedText, pluginDisplayName, pluginShortId } from '@/plugins/localize'
import { PluginSettingsForm, schemaFields } from '@/plugins/PluginSettingsForm'
import { builtinOrder, getBuiltinNavigation, isPluginRunning } from '@/plugins/navigation'

interface RelatedPluginsProps {
  /** 设置页分区；列出归属该分区的内置功能 */
  section: string
  /** 功能的专用设置面板，优先于按设置 Schema 自动生成的表单 */
  settings?: Record<string, ReactNode>
  /** 当前状态下功能不会生效等需要提醒的情况，显示在说明下方 */
  notes?: Record<string, string | undefined>
  disabled?: boolean
  onBusyChange?: (busy: boolean) => void
}

/**
 * 这些功能要先填好配置并授权才能开启（服务端会校验），启停放在它自己的设置面板里：
 * 条目上不提供快捷开关，面板在功能关闭时也能展开。
 */
const SELF_MANAGED = ['markvault.image-hosting']

const isEnabled = (plugin: PluginState) => plugin.enabled && !plugin.disabled

/**
 * 设置页某个分区里的内置功能：每项一个开关，带选项的功能开启后可展开设置。
 * 开关立即同步；折叠保留草稿，关闭时卸载设置面板。
 * 界面主题和页面版式由各自的选择器管理，不在这里列出；第三方插件在自定义插件页管理。
 */
export function RelatedPlugins({
  section,
  settings = {},
  notes = {},
  disabled = false,
  onBusyChange,
}: RelatedPluginsProps) {
  const { t, i18n } = useTranslation('plugins')
  const { directory, refresh, safe } = usePlugins()
  const [searchParams, setSearchParams] = useSearchParams()
  const expandedId = searchParams.get('plugin')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const expand = (id: string | null) =>
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (id) next.set('plugin', id)
        else next.delete('plugin')
        return next
      },
      { replace: true }
    )
  const hasContent = (plugin: PluginState) =>
    Boolean(settings[plugin.manifest.id]) ||
    (!SELF_MANAGED.includes(plugin.manifest.id) &&
      schemaFields(plugin.manifest.settings).length > 0)
  const toggle = async (plugin: PluginState, enabled: boolean) => {
    setBusyId(plugin.manifest.id)
    setError('')
    onBusyChange?.(true)
    try {
      await pluginAPI.save(plugin, enabled, plugin.config, plugin.grants)
      await refresh()
      if (enabled && hasContent(plugin)) expand(plugin.manifest.id)
      else if (expandedId === plugin.manifest.id) expand(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('error'))
    } finally {
      setBusyId(null)
      onBusyChange?.(false)
    }
  }
  if (!directory)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('loading')}
      </p>
    )
  // 按登记顺序排列，不随开关状态换位（目录本身按 ID 字母序返回）
  const items = directory.plugins
    .filter((plugin) => {
      if (plugin.origin !== 'builtin') return false
      const navigation = getBuiltinNavigation(plugin.manifest.id)
      return navigation?.section === section && !navigation.picker
    })
    .sort((a, b) => builtinOrder(a.manifest.id) - builtinOrder(b.manifest.id))
  if (items.length === 0) return null
  return (
    <section className="settings-related-plugins" aria-label={t('relatedPlugins')}>
      <div className="settings-plugin-heading">
        <h2 className="text-sm font-semibold inline-flex items-center gap-2">
          <SlidersHorizontal size={14} aria-hidden="true" />
          {t('relatedPlugins')}
        </h2>
      </div>
      {items.some(hasContent) && (
        <p className="settings-plugin-save-hint">{t('inlineSettingsHint')}</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-error mb-2">
          {error}
        </p>
      )}
      <div className="settings-plugin-list">
        {items.map((plugin) => {
          const id = plugin.manifest.id
          const name = pluginDisplayName(plugin, i18n.language)
          const navigation = getBuiltinNavigation(id)
          const running = !safe && isPluginRunning(plugin)
          const selfManaged = SELF_MANAGED.includes(id)
          const configurable = hasContent(plugin)
          // 一般功能开启并运行后才挂载设置面板；自带启停的功能随时可以展开
          const available = configurable && (running || (selfManaged && !safe && !plugin.disabled))
          const expanded = available && expandedId === id
          const panelId = 'settings-panel-' + id
          const summary = t('summary.' + pluginShortId(id), {
            defaultValue: localizedText(plugin.manifest.description || '', i18n.language),
          })
          // 开关已经表达了开与关，只有开着却没在运行、或被管理员停用时才另外标出状态
          const abnormal = plugin.enabled && !plugin.disabled && plugin.status !== 'running'
          const status =
            busyId === id
              ? t('updatingPlugin')
              : plugin.disabled
                ? t('instanceDisabled')
                : abnormal || selfManaged
                  ? t('status.' + plugin.status)
                  : ''
          const openPage = navigation?.page && running
          return (
            <div
              key={id}
              className="settings-plugin-entry"
              data-plugin-id={id}
              data-enabled={isEnabled(plugin)}
            >
              <div className="settings-plugin-row">
                <span className="settings-plugin-icon">
                  <PluginIcon plugin={plugin} size={16} />
                </span>
                <div className="settings-plugin-copy">
                  <span className="settings-plugin-name">{name}</span>
                  {summary && <p className="settings-plugin-summary">{summary}</p>}
                  {notes[id] && <p className="settings-plugin-note">{notes[id]}</p>}
                </div>
                <div className="settings-plugin-state">
                  {status && (
                    <span
                      className="settings-plugin-status"
                      data-running={running}
                      data-status={plugin.status}
                    >
                      {status}
                    </span>
                  )}
                  {!selfManaged && (
                    <Toggle
                      checked={isEnabled(plugin)}
                      disabled={safe || disabled || Boolean(busyId) || plugin.disabled}
                      onChange={(enabled) => void toggle(plugin, enabled)}
                      ariaLabel={t('toggleNamedPlugin', { name })}
                    />
                  )}
                </div>
                {(configurable || openPage) && (
                  <div className="settings-plugin-actions">
                    {configurable && (
                      <button
                        type="button"
                        className="settings-plugin-action"
                        disabled={!available || disabled || Boolean(busyId)}
                        aria-expanded={expanded}
                        aria-controls={available ? panelId : undefined}
                        aria-label={t(expanded ? 'collapseNamedSettings' : 'expandNamedSettings', {
                          name,
                        })}
                        onClick={() => expand(expanded ? null : id)}
                      >
                        {t(expanded ? 'collapseSettings' : 'expandSettings')}
                        <ChevronDown
                          size={12}
                          aria-hidden="true"
                          className={expanded ? 'rotate-180' : ''}
                        />
                      </button>
                    )}
                    {openPage && (
                      <Link className="settings-plugin-action" to={navigation.page!}>
                        {t('openFeature')}
                        <ArrowUpRight size={12} aria-hidden="true" />
                      </Link>
                    )}
                  </div>
                )}
              </div>
              {available && (
                <div
                  id={panelId}
                  role="region"
                  aria-label={t('namedSettings', { name })}
                  className="settings-plugin-panel"
                  hidden={!expanded}
                >
                  {settings[id] || <PluginSettingsForm plugin={plugin} />}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
