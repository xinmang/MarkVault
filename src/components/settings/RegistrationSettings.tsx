import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { UserPlus } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { assertData } from '@/services'
import { Toggle } from '@/components/common/Toggle'
import { SettingsItem, SettingsSection } from './SettingsSection'

export function RegistrationSettings() {
  const { t } = useTranslation('settings')
  const client = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const query = useQuery({
    queryKey: ['registration-settings'],
    staleTime: 0,
    queryFn: async () =>
      assertData(
        (await apiClient.get<{ registration_enabled: boolean; locked: boolean }>('/settings/auth'))
          .data,
        '读取注册设置'
      ),
  })
  const toggle = async (enabled: boolean) => {
    setBusy(true)
    setError('')
    try {
      const response = await apiClient.put('/settings/auth', { registration_enabled: enabled })
      client.setQueryData(['registration-settings'], assertData(response.data, '保存注册设置'))
      await client.invalidateQueries({ queryKey: ['auth-options'] })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('registration.failed'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <SettingsSection title={t('registration.title')} icon={UserPlus}>
      {error && (
        <p role="alert" className="text-sm text-error mb-2">
          {error}
        </p>
      )}
      {query.isError ? (
        <button className="btn btn-secondary btn-sm" onClick={() => void query.refetch()}>
          {t('registration.retry')}
        </button>
      ) : (
        <SettingsItem
          title={t('registration.label')}
          description={
            query.data?.locked ? t('registration.locked') : t('registration.description')
          }
          action={
            <Toggle
              checked={query.data?.registration_enabled ?? false}
              disabled={busy || !query.data || query.data.locked}
              onChange={(value) => void toggle(value)}
              ariaLabel={t('registration.label')}
            />
          }
        />
      )}
    </SettingsSection>
  )
}
