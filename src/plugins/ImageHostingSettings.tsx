import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PluginState } from '@shared/plugin-types'
import { imageHostingDefaults, imagePurposes, type ImageHostingConfig } from '@shared/image-hosting'
import { apiClient } from '@/lib/api-client'
import { usePlugins } from './context'

export function ImageHostingSettings({ plugin }: { plugin: PluginState }) {
  const { t } = useTranslation('plugins')
  const { directory, refresh } = usePlugins()
  const [config, setConfig] = useState<ImageHostingConfig>({
    ...imageHostingDefaults,
    ...plugin.config,
    backend:
      plugin.config.backend === 'http' || (!plugin.config.backend && plugin.config.endpoint)
        ? 'http'
        : 's3',
  })
  const [enabled, setEnabled] = useState(plugin.enabled)
  const [granted, setGranted] = useState(plugin.grants.includes('network.fetch'))
  const [secret, setSecret] = useState('')
  const [accessKeyId, setAccessKeyId] = useState('')
  const [secretAccessKey, setSecretAccessKey] = useState('')
  const [hasSecret, setHasSecret] = useState(false)
  const [clearSecret, setClearSecret] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    let alive = true
    apiClient
      .get<{ hasSecret: boolean }>('/plugins/image-hosting/settings')
      .then((result) => {
        if (alive) setHasSecret(Boolean(result.data?.hasSecret))
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : t('error'))
      })
    return () => {
      alive = false
    }
  }, [t])
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      await work()
      await refresh()
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error'))
    } finally {
      setBusy(false)
    }
  }
  const s3 = config.backend === 's3'
  const textFields = s3
    ? (['endpoint', 'bucket', 'region', 'prefix', 'publicURL'] as const)
    : (['endpoint', 'fileField', 'urlPath'] as const)
  return (
    <section className="space-y-5">
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault()
          void run(async () => {
            await apiClient.put('/plugins/image-hosting/settings', {
              enabled,
              config,
              granted,
              secret: s3 ? '' : secret,
              accessKeyId: s3 ? accessKeyId : '',
              secretAccessKey: s3 ? secretAccessKey : '',
              clearSecret,
            })
            setSecret('')
            setAccessKeyId('')
            setSecretAccessKey('')
            setClearSecret(false)
          })
        }}
      >
        <p className="text-sm text-muted-foreground">{t('imageHosting.intro')}</p>
        {error && (
          <p role="alert" className="text-red-500">
            {error}
          </p>
        )}
        {saved && <p role="status">{t('imageHosting.saved')}</p>}
        <label className="flex gap-3 items-center">
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy || plugin.disabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span>{t('imageHosting.enabled')}</span>
        </label>
        <fieldset className="plugin-image-purposes border border-border rounded-xl p-4 space-y-3" disabled={busy}>
          <legend className="px-2 font-semibold">{t('imageHosting.purposes')}</legend>
          {imagePurposes.map((purpose) => (
            <label key={purpose} className="flex gap-3 items-start">
              <input
                type="checkbox"
                checked={config.purposes.includes(purpose)}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    purposes: e.target.checked
                      ? [...config.purposes, purpose]
                      : config.purposes.filter((p) => p !== purpose),
                  })
                }
              />
              <span>{t('imageHosting.purpose.' + purpose)}</span>
            </label>
          ))}
          <p className="text-sm text-muted-foreground">{t('imageHosting.scope')}</p>
        </fieldset>
        <label className="plugin-field block space-y-2">
          <span className="font-medium">{t('imageHosting.backend')}</span>
          <select
            className="input w-full"
            value={config.backend}
            disabled={busy}
            onChange={(e) => {
              setConfig({ ...config, backend: e.target.value as 's3' | 'http' })
              setSecret('')
              setAccessKeyId('')
              setSecretAccessKey('')
            }}
          >
            <option value="s3">S3 / Cloudflare R2 / MinIO</option>
            <option value="http">{t('imageHosting.httpBackend')}</option>
          </select>
        </label>
        {s3 && <p className="text-sm text-muted-foreground">{t('imageHosting.s3Hint')}</p>}
        {textFields.map((field) => (
          <label key={field} className="plugin-field block space-y-2">
            <span className="font-medium">
              {t('imageHosting.' + (field === 'endpoint' && s3 ? 's3Endpoint' : field))}
            </span>
            <input
              className="input w-full"
              type={field === 'endpoint' || field === 'publicURL' ? 'url' : 'text'}
              required={enabled && field !== 'prefix' && field !== 'publicURL'}
              disabled={busy}
              maxLength={field === 'endpoint' || field === 'publicURL' ? 2048 : 256}
              value={config[field]}
              placeholder={
                field === 'endpoint'
                  ? s3
                    ? 'https://s3.us-east-1.amazonaws.com'
                    : 'https://images.example.com/api/upload'
                  : imageHostingDefaults[field]
              }
              onChange={(e) => setConfig({ ...config, [field]: e.target.value })}
            />
          </label>
        ))}
        {s3 ? (
          <>
            <label className="flex gap-3 items-center">
              <input
                type="checkbox"
                checked={config.pathStyle}
                disabled={busy}
                onChange={(e) => setConfig({ ...config, pathStyle: e.target.checked })}
              />
              <span>{t('imageHosting.pathStyle')}</span>
            </label>
            <p className="text-sm text-muted-foreground">{t('imageHosting.publicHint')}</p>
            {(['accessKeyId', 'secretAccessKey'] as const).map((field) => (
              <label key={field} className="plugin-field block space-y-2">
                <span className="font-medium">
                  {field === 'accessKeyId' ? 'Access Key ID' : 'Secret Access Key'}
                </span>
                <input
                  className="input w-full"
                  type="password"
                  autoComplete="new-password"
                  disabled={busy || clearSecret}
                  maxLength={field === 'accessKeyId' ? 128 : 1024}
                  value={field === 'accessKeyId' ? accessKeyId : secretAccessKey}
                  onChange={(e) =>
                    field === 'accessKeyId'
                      ? setAccessKeyId(e.target.value)
                      : setSecretAccessKey(e.target.value)
                  }
                  placeholder={t(
                    hasSecret ? 'imageHosting.s3KeysSaved' : 'imageHosting.s3KeysEmpty'
                  )}
                />
              </label>
            ))}
          </>
        ) : (
          <>
            <label className="block space-y-2">
              <span className="font-medium">{t('imageHosting.authHeader')}</span>
              <input
                className="input w-full"
                disabled={busy}
                value={config.authHeader}
                maxLength={64}
                placeholder="Authorization / X-API-Key"
                onChange={(e) => setConfig({ ...config, authHeader: e.target.value })}
              />
              <small className="block text-muted-foreground">{t('imageHosting.authHint')}</small>
            </label>
            <label className="block space-y-2">
              <span className="font-medium">{t('imageHosting.secret')}</span>
              <input
                className="input w-full"
                type="password"
                autoComplete="new-password"
                disabled={busy || clearSecret}
                maxLength={8192}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={t(hasSecret ? 'imageHosting.secretSaved' : 'imageHosting.secretEmpty')}
              />
            </label>
          </>
        )}
        {s3 && <p className="text-sm text-muted-foreground">{t('imageHosting.keyRetention')}</p>}
        {hasSecret && (
          <label className="flex gap-3 items-center">
            <input
              type="checkbox"
              checked={clearSecret}
              disabled={busy}
              onChange={(e) => setClearSecret(e.target.checked)}
            />
            {t('imageHosting.clearSecret')}
          </label>
        )}
        <label className="flex gap-3 items-start rounded-xl border border-border p-4">
          <input
            type="checkbox"
            checked={granted}
            disabled={busy}
            onChange={(e) => setGranted(e.target.checked)}
          />
          <span>
            {t('imageHosting.grant')}
            <small className="block text-muted-foreground mt-1">{t('imageHosting.privacy')}</small>
          </span>
        </label>
        <button className="btn btn-primary" disabled={busy || plugin.disabled}>
          {t('imageHosting.save')}
        </button>
      </form>
      <section className="border-t border-border pt-5 space-y-3">
        <h2 className="font-semibold">{t('imageHosting.defaultTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('imageHosting.defaultHint')}</p>
        {directory?.defaultBookmarkImage && (
          <img
            src={directory.defaultBookmarkImage}
            alt={t('imageHosting.defaultTitle')}
            className="w-24 h-24 object-contain rounded-xl border border-border"
          />
        )}
        <label className="block space-y-2">
          <span>{t('imageHosting.uploadDefault')}</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy || plugin.status !== 'running'}
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              void run(async () => {
                if (file.size > 2 * 1024 * 1024) throw new Error(t('imageHosting.tooLarge'))
                const image = await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader()
                  reader.onload = () => resolve(String(reader.result))
                  reader.onerror = () => reject(new Error(t('imageHosting.readFailed')))
                  reader.readAsDataURL(file)
                })
                await apiClient.post('/plugins/image-hosting/default-image', { image })
              })
            }}
          />
        </label>
        {directory?.defaultBookmarkImage && (
          <button
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => void run(() => apiClient.delete('/plugins/image-hosting/default-image'))}
          >
            {t('imageHosting.removeDefault')}
          </button>
        )}
      </section>
    </section>
  )
}
