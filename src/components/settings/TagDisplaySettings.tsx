import { useState } from 'react'
import { Tags } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useTags } from '@/hooks/useTags'
import { TagManageModal } from '@/components/tags/TagManageModal'
import { TagIcon } from '@/components/tags/TagIcon'
import { SettingsSwitchSection } from './SettingsSwitchRow'

interface TagDisplaySettingsProps {
  enabled: boolean
  onEnabledChange: (enabled: boolean) => void
}

export function TagDisplaySettings({ enabled, onEnabledChange }: TagDisplaySettingsProps) {
  const { t } = useTranslation('settings')
  const [manageOpen, setManageOpen] = useState(false)
  const { data, isLoading, isError, refetch } = useTags(undefined, { enabled: manageOpen })
  return (
    <SettingsSwitchSection
      icon={Tags}
      title={t('tagIcons.title')}
      enableLabel={t('tagIcons.enable')}
      enableDescription={t('tagIcons.hint')}
      checked={enabled}
      onChange={onEnabledChange}
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4 text-sm text-muted-foreground" aria-hidden="true">
            {['GitHub', 'Docker', 'Python'].map((name) => (
              <span key={name} className="flex items-center gap-1.5">
                <TagIcon name={name} />
                {name}
              </span>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-outline btn-sm min-h-11"
            onClick={() => setManageOpen(true)}
          >
            {t('tagIcons.manage')}
          </button>
        </div>
        {manageOpen && isLoading && (
          <p className="text-sm text-muted-foreground" role="status">
            {t('tagIcons.loading')}
          </p>
        )}
        {manageOpen && isError && (
          <button type="button" className="btn btn-outline btn-sm" onClick={() => void refetch()}>
            {t('tagIcons.retry')}
          </button>
        )}
      </div>
      {manageOpen && data && (
        <TagManageModal tags={data.tags} onClose={() => setManageOpen(false)} />
      )}
    </SettingsSwitchSection>
  )
}
