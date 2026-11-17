import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PluginState } from '@shared/plugin-types'
import { apiClient } from '@/lib/api-client'
import { usePlugins } from './context'

export function PluginAdvancedSettings({ plugin }: { plugin: PluginState }) {
  const { t } = useTranslation('plugins')
  const { refresh } = usePlugins()
  const [credential, setCredential] = useState('')
  const [target, setTarget] = useState('')
  const [secret, setSecret] = useState('')
  const [tools, setTools] = useState<{ name: string; title: string }[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [keyIDs, setKeyIDs] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    apiClient
      .get<{ tools: { name: string; title: string; pluginId?: string }[] }>('/plugins/tools')
      .then((response) => {
        if (active)
          setTools(
            (response.data?.tools ?? []).filter((tool) => tool.pluginId === plugin.manifest.id)
          )
      })
      .catch(() => {
        if (active) setError(t('advanced.loadFailed'))
      })
    return () => {
      active = false
    }
  }, [plugin.manifest.id, t])
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="border border-border rounded-xl p-4 space-y-4">
      <h2 className="font-semibold">{t('advanced.title')}</h2>
      {error && (
        <p role="alert" className="text-red-500">
          {error}
        </p>
      )}
      {plugin.origin !== 'builtin' && (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void run(async () => {
              await apiClient.put('/plugins/' + plugin.manifest.id + '/credentials', {
                name: credential,
                target,
                secret,
              })
              setSecret('')
            })
          }}
        >
          <input
            required
            value={credential}
            onChange={(e) => setCredential(e.target.value)}
            className="border border-border rounded p-2 bg-background"
            aria-label={t('advanced.credentialName')}
            placeholder={t('advanced.credentialName')}
          />
          <input
            type="url"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="border border-border rounded p-2 bg-background"
            aria-label={t('advanced.credentialTarget')}
            placeholder="https://api.example.com"
          />
          <input
            type="password"
            autoComplete="off"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className="border border-border rounded p-2 bg-background"
            aria-label={t('advanced.secret')}
            placeholder={t('advanced.secretPlaceholder')}
          />
          <button disabled={busy} className="btn btn-secondary">
            {t('advanced.saveCredential')}
          </button>
        </form>
      )}
      {tools.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t('advanced.exposureHint')}</p>
          {tools.map((tool) => (
            <label className="flex gap-2" key={tool.name}>
              <input
                type="checkbox"
                checked={selected.includes(tool.name)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...selected, tool.name]
                      : selected.filter((name) => name !== tool.name)
                  )
                }
              />
              {tool.title}
            </label>
          ))}
          <input
            value={keyIDs}
            onChange={(e) => setKeyIDs(e.target.value)}
            className="w-full border border-border rounded p-2 bg-background"
            aria-label={t('advanced.keyIds')}
            placeholder={t('advanced.keyIdsPlaceholder')}
          />
          <button
            disabled={busy}
            className="btn btn-secondary"
            onClick={() =>
              void run(() =>
                apiClient.put('/plugins/' + plugin.manifest.id + '/exposure', {
                  tools: selected,
                  keyIds: keyIDs
                    .split(',')
                    .map((id) => id.trim())
                    .filter(Boolean),
                })
              )
            }
          >
            {t('advanced.saveExposure')}
          </button>
        </div>
      )}
    </section>
  )
}
