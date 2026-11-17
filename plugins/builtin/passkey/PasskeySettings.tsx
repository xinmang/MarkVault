import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { KeyRound, Trash2 } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { assertData } from '@/services'
import { useAuthStore } from '@/stores/authStore'
import { registerPasskey, passkeySupported, type PasskeyEntry } from './client'

export function PasskeySettings() {
  const { t } = useTranslation('auth')
  const uid = useAuthStore((state) => state.user?.id)
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const query = useQuery({
    queryKey: ['passkeys', uid],
    staleTime: 0,
    queryFn: async () =>
      assertData(
        (await apiClient.get<{ credentials: PasskeyEntry[] }>('/auth/passkey/credentials')).data,
        '读取通行密钥'
      ),
  })
  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      setPassword('')
      setNotice(message)
      await query.refetch()
      await queryClient.invalidateQueries({ queryKey: ['auth-options'] })
    } catch (cause) {
      setError(
        cause instanceof DOMException && cause.name === 'NotAllowedError'
          ? t('passkey.cancelled')
          : cause instanceof Error
            ? cause.message
            : t('passkey.failed')
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('passkey.description')}</p>
      {!passkeySupported() && (
        <p role="status" className="text-sm text-warning">
          {t('passkey.unsupported')}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-success">
          {notice}
        </p>
      )}
      <form
        className="settings-form-list"
        onSubmit={(event) => {
          event.preventDefault()
          void run(() => registerPasskey(name, password), t('passkey.added'))
        }}
      >
        <label className="settings-inline-field">
          <span>{t('passkey.name')}</span>
          <input
            className="input"
            value={name}
            maxLength={64}
            required
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="settings-inline-field">
          <span>{t('passkey.password')}</span>
          <input
            className="input"
            type="password"
            value={password}
            required
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </label>
        <div className="settings-form-actions">
          <button
            className="btn btn-primary btn-sm gap-2"
            disabled={busy || !passkeySupported() || !name.trim() || !password}
          >
            <KeyRound size={16} />
            {t(busy ? 'passkey.working' : 'passkey.add')}
          </button>
        </div>
      </form>
      {query.isPending ? (
        <p role="status">{t('passkey.loading')}</p>
      ) : query.isError ? (
        <div role="alert">
          <span>{t('passkey.loadFailed')}</span>
          <button className="btn btn-sm btn-ghost" onClick={() => void query.refetch()}>
            {t('passkey.retry')}
          </button>
        </div>
      ) : (
        <div className="settings-plugin-list">
          {query.data.credentials.length === 0 && (
            <p className="p-3 text-sm text-muted-foreground">{t('passkey.empty')}</p>
          )}
          {query.data.credentials.map((key) => (
            <div className="settings-plugin-entry" key={key.id}>
              <div className="settings-plugin-row">
                <div className="passkey-entry-copy min-w-0 flex-1">
                  <strong>{key.name}</strong>
                  <p className="text-xs text-muted-foreground">
                    {key.rp_id} ·{' '}
                    {key.last_used_at
                      ? t('passkey.lastUsed', { date: new Date(key.last_used_at).toLocaleString() })
                      : t('passkey.unused')}
                  </p>
                </div>
                <button
                  className="passkey-entry-delete btn btn-ghost btn-sm text-error gap-2"
                  disabled={busy || !password}
                  aria-label={t('passkey.deleteNamed', { name: key.name })}
                  onClick={() => {
                    if (window.confirm(t('passkey.deleteConfirm', { name: key.name })))
                      void run(
                        () =>
                          apiClient.post(
                            '/auth/passkey/credentials/' + encodeURIComponent(key.id) + '/delete',
                            { password }
                          ),
                        t('passkey.deleted')
                      )
                  }}
                >
                  <Trash2 size={14} />
                  {t('passkey.delete')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t('passkey.deleteHint')}</p>
    </div>
  )
}
