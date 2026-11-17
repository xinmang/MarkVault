import { useTranslation } from 'react-i18next'
import type { PluginState } from '@shared/plugin-types'
import { usePlugins } from './context'
import { pluginAPI } from './api'
import { useState } from 'react'

export function PluginModelSelector({ plugin }: { plugin: PluginState }) {
  const { directory, refresh } = usePlugins()
  const { i18n } = useTranslation()
  const en = i18n.language.startsWith('en')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const providers =
    directory?.plugins
      .filter((p) => p.status === 'running' && p.origin !== 'builtin')
      .flatMap((p) =>
        p.manifest.contributes
          .filter((c) => c.kind === 'provider')
          .map((c) => ({ id: p.manifest.id + '/' + c.id, title: c.title }))
      ) ?? []
  return (
    <label className="block space-y-2">
      <span className="font-semibold">{en ? 'Active model provider' : '当前模型供应商'}</span>
      <select
        className="block w-full bg-background border border-border rounded-lg p-2"
        disabled={busy}
        value={String(plugin.config.providerId ?? '')}
        onChange={async (e) => {
          setBusy(true)
          setError('')
          try {
            await pluginAPI.save(
              plugin,
              plugin.enabled,
              { ...plugin.config, providerId: e.target.value },
              plugin.grants
            )
            await refresh()
          } catch (error) {
            setError(error instanceof Error ? error.message : 'Error')
          } finally {
            setBusy(false)
          }
        }}
      >
        <option value="">
          {en ? 'Built-in providers (existing AI settings)' : '内置供应商（沿用原 AI 设置）'}
        </option>
        {providers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
          </option>
        ))}
      </select>
      {error && (
        <span role="alert" className="text-red-500">
          {error}
        </span>
      )}
    </label>
  )
}
