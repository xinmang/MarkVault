import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiClient } from '@/lib/api-client'
import { usePlugins } from './context'
import { localizedText } from './localize'
import type { PluginManifest } from '@shared/plugin-types'

interface Entry {
  manifest: PluginManifest
  origin: 'official' | 'community'
  sha256: string
  url?: string
}
export function PluginMarketplace() {
  const { t, i18n } = useTranslation('plugins')
  const { directory, refresh } = usePlugins()
  const [entries, setEntries] = useState<Entry[]>([])
  const [source, setSource] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const load = async () => {
    const result = await apiClient.get<{ entries: Entry[] }>('/plugins/catalog')
    setEntries(result.data?.entries ?? [])
  }
  useEffect(() => {
    let alive = true
    apiClient
      .get<{ entries: Entry[] }>('/plugins/catalog')
      .then((result) => {
        if (alive) setEntries(result.data?.entries ?? [])
      })
      .catch(() => {
        if (alive) setError(t('marketplace.loadFailed'))
      })
    return () => {
      alive = false
    }
  }, [t])
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      await load()
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="plugin-marketplace space-y-4 border border-border rounded-2xl p-5">
      <h2 className="text-xl font-semibold">{t('marketplace.title')}</h2>
      <p className="text-sm text-muted-foreground">{t('marketplace.intro')}</p>
      {error && (
        <p role="alert" className="text-red-500">
          {error}
        </p>
      )}
      <div className="plugin-marketplace-grid grid gap-4 md:grid-cols-3">
        {entries.map((entry) => {
          const installed = directory?.plugins.find(
            (item) => item.manifest.id === entry.manifest.id
          )
          return (
            <article
              key={entry.manifest.id + entry.sha256}
              className="plugin-marketplace-card border border-border rounded-xl p-4 space-y-2"
            >
              <p className="text-xs text-muted-foreground">
                {t(entry.origin === 'official' ? 'official' : 'community')}
              </p>
              <h3 className="font-semibold">{localizedText(entry.manifest.name, i18n.language)}</h3>
              <p className="text-sm">
                {localizedText(entry.manifest.description ?? '', i18n.language)}
              </p>
              <p className="text-xs">{entry.manifest.version}</p>
              {directory?.admin && (
                <button
                  disabled={busy || installed?.manifest.version === entry.manifest.version}
                  className="btn btn-sm btn-secondary"
                  onClick={() =>
                    void run(() =>
                      apiClient.post('/plugin-admin/catalog/install', {
                        id: entry.manifest.id,
                        version: entry.manifest.version,
                        sha256: entry.sha256,
                      })
                    )
                  }
                >
                  {t(
                    installed?.manifest.version === entry.manifest.version
                      ? 'marketplace.installed'
                      : 'marketplace.install'
                  )}
                </button>
              )}
            </article>
          )
        })}
      </div>
      {directory?.admin && (
        <form
          className="flex flex-wrap gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void run(() => apiClient.post('/plugin-admin/catalog/refresh', { url: source }))
          }}
        >
          <input
            required
            type="url"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            className="border border-border rounded-lg bg-transparent p-2 flex-1 min-w-0"
            placeholder={t('marketplace.sourcePlaceholder')}
            aria-label={t('marketplace.sourceLabel')}
          />
          <button disabled={busy} className="btn btn-secondary">
            {t('marketplace.refresh')}
          </button>
        </form>
      )}
    </section>
  )
}
