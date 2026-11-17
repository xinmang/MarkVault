import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Puzzle,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
  RotateCcw,
  Power,
  ArrowLeft,
} from 'lucide-react'
import { useDefaultManagementTheme } from '@/components/settings/useDefaultManagementTheme'
import { usePlugins } from '@/plugins/context'
import { pluginAPI } from '@/plugins/api'
import { apiClient } from '@/lib/api-client'
import { useAuthStore } from '@/stores/authStore'
import { SandboxPanel } from '@/plugins/SandboxPanel'
import { PluginMarketplace } from '@/plugins/PluginMarketplace'
import { PluginAdvancedSettings } from '@/plugins/PluginAdvancedSettings'
import { PluginSettingsForm, schemaFields } from '@/plugins/PluginSettingsForm'
import { PluginIcon } from '@/plugins/icons'
import { localizedText, pluginDisplayName } from '@/plugins/localize'
import type { PluginState } from '@shared/plugin-types'
import { featureSettingsPath, getPluginCategory } from '@/plugins/navigation'

const STATUS_FILTERS = ['all', 'enabled', 'disabled'] as const
const SOURCES = ['all', 'official', 'community'] as const
const KINDS = [
  'all',
  'theme',
  'motion',
  'background',
  'page',
  'panel',
  'action',
  'agent',
  'provider',
  'tool',
  'mcp',
] as const

/** 列表与详情共用的摘要：取清单描述中对应语言的一半，没有描述时退回能力列表。 */
function usePluginText() {
  const { t, i18n } = useTranslation('plugins')
  return {
    name: (plugin: PluginState) => pluginDisplayName(plugin, i18n.language),
    summary: (plugin: PluginState): string =>
      localizedText(plugin.manifest.description || '', i18n.language) ||
      plugin.manifest.contributes.map((c) => t('kind.' + c.kind)).join(' · '),
  }
}

function StatusBadge({ plugin, className = '' }: { plugin: PluginState; className?: string }) {
  const { t } = useTranslation('plugins')
  return (
    <span className={'plugins-status ' + className} data-status={plugin.status}>
      <span className="plugins-status__dot" aria-hidden="true" />
      {t('status.' + plugin.status)}
    </span>
  )
}

/** 自定义插件页：只管理另外安装的第三方插件。内置功能在设置页的各个分区里开关和配置。 */
export function PluginsPage() {
  const { t } = useTranslation('plugins')
  const text = usePluginText()
  const compact = useDefaultManagementTheme()
  const { directory, refresh, safe } = usePlugins()
  const [search, setSearch] = useState('')
  const [view, setView] = useState('all')
  const [kind, setKind] = useState('all')
  const [state, setState] = useState<(typeof STATUS_FILTERS)[number]>('all')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [url, setURL] = useState('')
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await work()
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error'))
    } finally {
      setBusy(false)
    }
  }
  const items =
    directory?.plugins.filter(
      (item) =>
        item.origin !== 'builtin' &&
        (view === 'all' || item.origin === view) &&
        (kind === 'all' || item.manifest.contributes.some((c) => c.kind === kind)) &&
        (state === 'all' || (item.enabled && !item.disabled) === (state === 'enabled')) &&
        (item.manifest.name + item.manifest.id + item.manifest.description + text.summary(item))
          .toLowerCase()
          .includes(search.toLowerCase())
    ) ?? []
  return (
    <div
      data-management-theme={compact ? 'default' : undefined}
      className="management-plugins max-w-6xl mx-auto px-4 py-8 space-y-6"
    >
      <div className="plugins-heading flex flex-wrap gap-4 justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold flex gap-3 items-center">
            <Puzzle />
            {t('title')}
          </h1>
          <p className="text-muted-foreground mt-2">
            {t('subtitle')}{' '}
            <Link
              className="text-primary underline underline-offset-4"
              to={'/settings/general' + (safe ? '?safe=1' : '')}
            >
              {t('openSettings')}
            </Link>
          </p>
        </div>
        <Link className="btn btn-sm btn-secondary" to={safe ? '/plugins' : '/plugins?safe=1'}>
          {t(safe ? 'exitSafe' : 'safe')}
        </Link>
      </div>
      {safe && (
        <p role="status" className="p-4 rounded-xl border border-border">
          {t('safeNotice')}
        </p>
      )}
      {!compact && <PluginMarketplace />}
      {error && (
        <p role="alert" className="text-red-500">
          {error}
        </p>
      )}
      {/* 搜索与三个筛选收在同一排：状态用分段按钮，来源与能力用下拉框 */}
      <div className="plugins-toolbar flex flex-wrap items-center gap-2">
        <div className="plugins-search flex border border-border rounded-lg items-center px-3 gap-2 flex-1 min-w-48">
          <Search size={16} aria-hidden="true" />
          <input
            className="bg-transparent py-2 w-full min-w-0"
            aria-label={t('search')}
            placeholder={t('search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="plugins-segmented" role="group" aria-label={t('filter.status')}>
          {STATUS_FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={state === value}
              onClick={() => setState(value)}
            >
              {t('filter.' + value)}
            </button>
          ))}
        </div>
        <select
          className="plugins-select bg-background border border-border rounded-lg p-2"
          value={view}
          aria-label={t('filter.source')}
          onChange={(e) => setView(e.target.value)}
        >
          {SOURCES.map((value) => (
            <option key={value} value={value}>
              {t(value === 'all' ? 'filter.sourceAll' : value)}
            </option>
          ))}
        </select>
        <select
          className="plugins-select bg-background border border-border rounded-lg p-2"
          value={kind}
          aria-label={t('capability')}
          onChange={(e) => setKind(e.target.value)}
        >
          {KINDS.map((value) => (
            <option key={value} value={value}>
              {t('kind.' + value)}
            </option>
          ))}
        </select>
        {directory && <span className="plugins-count">{t('count', { count: items.length })}</span>}
      </div>
      {!directory ? (
        <p role="status">{t('loading')}</p>
      ) : items.length === 0 ? (
        <p className="p-8 text-muted-foreground">{t('empty')}</p>
      ) : (
        <div className="plugins-installed grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <Link
              key={item.manifest.id}
              to={'/plugins/' + item.manifest.id + (safe ? '?safe=1' : '')}
              className="plugin-card rounded-2xl border border-border p-5 hover:border-primary transition-colors flex flex-col gap-3"
              data-enabled={item.enabled && !item.disabled}
            >
              <div className="plugin-card-head flex flex-wrap items-start gap-3">
                <span className="plugins-icon plugin-card-icon">
                  <PluginIcon plugin={item} size={20} />
                </span>
                <div className="plugin-card-title min-w-0 flex-1">
                  <h2 className="plugin-card-name font-semibold text-lg leading-snug">
                    {text.name(item)}
                  </h2>
                  <p className="plugin-card-id text-xs text-muted-foreground">
                    {item.manifest.id} · {item.manifest.version}
                  </p>
                </div>
                <StatusBadge plugin={item} className="plugin-card-status" />
              </div>
              <p className="plugin-card-description text-sm">{text.summary(item)}</p>
              {item.reason && (
                <p className="plugin-card-reason text-sm text-muted-foreground">{item.reason}</p>
              )}
              <div className="plugin-card-meta mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>
                  {t('category.' + getPluginCategory(item))} · {t(item.origin)}
                </span>
                {schemaFields(item.manifest.settings).length > 0 && (
                  <span className="plugin-card-tag">
                    <SlidersHorizontal size={12} aria-hidden="true" />
                    {t('configurable')}
                  </span>
                )}
                {item.manifest.permissions.length > 0 && (
                  <span className="plugin-card-tag">
                    <ShieldCheck size={12} aria-hidden="true" />
                    {t('permissionCount', { count: item.manifest.permissions.length })}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
      {compact && <PluginMarketplace />}
      {directory?.admin && (
        <section className="plugin-install rounded-2xl border border-border p-5 space-y-4">
          <h2 className="text-lg font-semibold flex gap-2">
            <ShieldCheck />
            {t('install')}
          </h2>
          <p className="text-muted-foreground text-sm">{t('installNote')}</p>
          <div className="flex flex-wrap gap-3">
            <input
              type="url"
              value={url}
              onChange={(e) => setURL(e.target.value)}
              placeholder="https://github.com/owner/repo/releases/download/v1.0.0/plugin.zip"
              className="flex-1 min-w-0 border border-border rounded-lg p-2 bg-transparent"
              aria-label={t('releaseURL')}
            />
            <button
              disabled={busy || !url}
              className="btn btn-primary"
              onClick={() => void run(() => apiClient.post('/plugin-admin/install', { url }))}
            >
              {t('installRelease')}
            </button>
          </div>
          <label className="btn btn-secondary inline-flex gap-2 cursor-pointer">
            <Upload size={18} />
            {t('installZip')}
            <input
              type="file"
              accept=".zip,application/zip"
              className="sr-only"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (!file) return
                event.target.value = ''
                void run(async () => {
                  if (file.size > 16 * 1024 * 1024) throw new Error(t('tooLarge'))
                  const response = await fetch('/api/v1/plugin-admin/install', {
                    method: 'POST',
                    headers: {
                      Authorization: 'Bearer ' + useAuthStore.getState().accessToken,
                      'Content-Type': 'application/zip',
                    },
                    body: file,
                  })
                  if (!response.ok) {
                    const result = await response.json()
                    throw new Error(result.error?.message ?? t('error'))
                  }
                })
              }}
            />
          </label>
        </section>
      )}
    </div>
  )
}

function PluginEditor({ plugin }: { plugin: PluginState }) {
  const { t } = useTranslation('plugins')
  const text = usePluginText()
  const compact = useDefaultManagementTheme()
  const { directory, refresh, safe } = usePlugins()
  const hasSchema = schemaFields(plugin.manifest.settings).length > 0
  // 没有设置 Schema 的插件只能编辑 JSON；有表单时 JSON 收在「高级」里
  const [jsonOpen, setJsonOpen] = useState(false)
  const showJSON = !hasSchema || jsonOpen
  const [config, setConfig] = useState(JSON.stringify(plugin.config, null, 2))
  // 表单里尚未保存的改动，启用或保存授权时一并提交，避免被已保存的配置覆盖
  const [formDraft, setFormDraft] = useState<Record<string, unknown> | null>(null)
  const [grants, setGrants] = useState(plugin.grants)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await work()
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error'))
    } finally {
      setBusy(false)
    }
  }
  const toggleJSON = () => {
    // 打开时带上表单草稿，切换编辑方式不丢改动
    if (!jsonOpen) setConfig(JSON.stringify(formDraft ?? plugin.config, null, 2))
    setFormDraft(null)
    setJsonOpen(!jsonOpen)
  }
  const permissions = plugin.manifest.permissions
  return (
    <div
      data-management-theme={compact ? 'default' : undefined}
      className="management-plugin-detail max-w-3xl mx-auto p-5 space-y-6"
    >
      <Link
        to={'/plugins' + (safe ? '?safe=1' : '')}
        className="plugin-back text-primary inline-flex items-center gap-2"
      >
        <ArrowLeft size={14} aria-hidden="true" /> {t('title')}
      </Link>
      <header className="plugin-detail-heading space-y-3">
        <div className="plugin-detail-title flex flex-wrap items-start gap-4">
          <span className="plugins-icon plugins-icon--large">
            <PluginIcon plugin={plugin} size={26} />
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <h1 className="text-3xl font-bold">{text.name(plugin)}</h1>
            <p className="plugin-detail-meta text-sm text-muted-foreground">
              {t('category.' + getPluginCategory(plugin))} · {t(plugin.origin)} · v
              {plugin.manifest.version} · {t('detail.author', { author: plugin.manifest.author })}
            </p>
            <p className="plugin-detail-id text-xs text-muted-foreground break-all">
              {plugin.manifest.id}
            </p>
          </div>
          <StatusBadge plugin={plugin} className="plugin-detail-status" />
        </div>
        <p className="plugin-detail-description">{text.summary(plugin)}</p>
        {plugin.reason && (
          <p className="plugin-detail-reason text-sm text-muted-foreground">{plugin.reason}</p>
        )}
      </header>
      {plugin.lastError && (
        <p role="alert" className="text-red-500">
          {plugin.lastError}
        </p>
      )}
      {error && (
        <p role="alert" className="text-red-500">
          {error}
        </p>
      )}
      <div className="plugin-editor-grid space-y-4" data-permissions={permissions.length > 0}>
        <section className="plugin-config space-y-3">
          <div className="plugin-config-heading flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{t(showJSON ? 'config' : 'detail.settings')}</h2>
            {hasSchema && (
              <button
                type="button"
                className="plugin-config-toggle text-xs text-muted-foreground hover:text-foreground underline underline-offset-4"
                onClick={toggleJSON}
              >
                {t(jsonOpen ? 'detail.backToForm' : 'detail.advancedJSON')}
              </button>
            )}
          </div>
          {showJSON ? (
            <>
              <textarea
                className="w-full min-h-40 font-mono text-sm bg-background border border-border rounded-xl p-3"
                aria-label={t('config')}
                value={config}
                onChange={(e) => setConfig(e.target.value)}
                spellCheck={false}
              />
              <p className="text-xs text-muted-foreground">
                {t('detail.jsonHint')}
                {hasSchema && ' ' + t('detail.jsonDiscardHint')}
              </p>
            </>
          ) : (
            <PluginSettingsForm plugin={plugin} onDraftChange={setFormDraft} />
          )}
        </section>
        {permissions.length === 0 ? (
          <p className="plugin-permissions-none flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck size={14} className="shrink-0" aria-hidden="true" />
            {t('noPermissions')}
          </p>
        ) : (
          <section className="plugin-permissions border border-border rounded-xl p-4 space-y-3">
            <h2 className="font-semibold">{t('permissions')}</h2>
            {permissions.map((permission) => (
              <label key={permission} className="plugin-permission-row flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={grants.includes(permission)}
                  onChange={(e) =>
                    setGrants(
                      e.target.checked
                        ? [...grants, permission]
                        : grants.filter((p) => p !== permission)
                    )
                  }
                />
                <span>
                  {t('permission.' + permission, { defaultValue: permission })}
                  <small className="block text-muted-foreground">{permission}</small>
                </span>
              </label>
            ))}
          </section>
        )}
        <div className="plugin-editor-actions flex flex-wrap gap-3">
          {/* 已启用且没有授权或 JSON 可保存时，表单自带保存按钮，不再重复一个 */}
          {(!plugin.enabled || showJSON || permissions.length > 0) && (
            <button
              disabled={busy || plugin.disabled}
              className="btn btn-primary gap-2"
              onClick={() =>
                void run(() =>
                  pluginAPI.save(
                    plugin,
                    true,
                    showJSON
                      ? (JSON.parse(config) as Record<string, unknown>)
                      : (formDraft ?? plugin.config),
                    grants
                  )
                )
              }
            >
              <Power size={18} />
              {t(plugin.enabled ? 'save' : 'enable')}
            </button>
          )}
          <button
            disabled={busy || !plugin.enabled}
            className="btn btn-secondary"
            onClick={() =>
              void run(() => pluginAPI.save(plugin, false, plugin.config, plugin.grants))
            }
          >
            {t('disable')}
          </button>
          {!plugin.enabled && (
            <button
              disabled={busy}
              className="btn btn-ghost"
              onClick={() => {
                if (window.confirm(t('clearConfirm')))
                  void run(() => apiClient.delete('/plugins/' + plugin.manifest.id + '/data'))
              }}
            >
              {t('clear')}
            </button>
          )}
        </div>
      </div>
      {!safe &&
        plugin.status === 'running' &&
        plugin.manifest.contributes
          .filter((c) => c.entry && ['page', 'panel', 'background'].includes(c.kind))
          .map((c) => (
            <section key={c.id}>
              <h2 className="font-semibold mb-3">{c.title}</h2>
              <SandboxPanel plugin={plugin} entry={c.entry!} />
            </section>
          ))}
      {directory?.admin && (
        <section className="plugin-instance-actions border-t border-border pt-5 flex flex-wrap gap-3">
          <button
            disabled={busy}
            className="btn btn-secondary"
            onClick={() =>
              void run(() =>
                apiClient.post(
                  '/plugin-admin/' +
                    plugin.manifest.id +
                    '/' +
                    (plugin.disabled ? 'allow' : 'disable')
                )
              )
            }
          >
            {t(plugin.disabled ? 'allowInstance' : 'disableInstance')}
          </button>
          {plugin.previousVersion && (
            <button
              disabled={busy}
              className="btn btn-secondary gap-2"
              onClick={() =>
                void run(() => apiClient.post('/plugin-admin/' + plugin.manifest.id + '/rollback'))
              }
            >
              <RotateCcw size={16} />
              {t('rollback')} {plugin.previousVersion}
            </button>
          )}
          <button
            disabled={busy}
            className="btn btn-ghost text-red-500"
            onClick={() => {
              if (window.confirm(t('uninstallConfirm')))
                void run(() => apiClient.post('/plugin-admin/' + plugin.manifest.id + '/uninstall'))
            }}
          >
            {t('uninstall')}
          </button>
        </section>
      )}
      {plugin.digest && <PluginAdvancedSettings plugin={plugin} />}
      {plugin.digest && (
        <p className="text-xs break-all text-muted-foreground">SHA-256: {plugin.digest}</p>
      )}
    </div>
  )
}

export function PluginDetailPage() {
  const { pluginId } = useParams()
  const { directory, safe } = usePlugins()
  const { t } = useTranslation('plugins')
  // 内置功能没有插件详情页，旧链接转到设置页里对应的条目
  if (pluginId?.startsWith('markvault.'))
    return <Navigate replace to={featureSettingsPath(pluginId, safe)} />
  const item = directory?.plugins.find((plugin) => plugin.manifest.id === pluginId)
  return item ? (
    <PluginEditor key={item.manifest.id + item.revision} plugin={item} />
  ) : (
    <main className="p-6">
      <Link to="/plugins">{t('title')}</Link>
      <p>{t(directory ? 'notFound' : 'loading')}</p>
    </main>
  )
}
