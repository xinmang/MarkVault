import { useTranslation } from 'react-i18next'
import { Camera } from 'lucide-react'
import { SettingsSection } from '../SettingsSection'
import { NumberSetting } from '../BookmarkLoadingSettings'

interface SnapshotSettingsTabProps {
  retentionCount: number
  onRetentionCountChange: (count: number) => void
}
export function SnapshotSettingsTab({
  retentionCount,
  onRetentionCountChange,
}: SnapshotSettingsTabProps) {
  const { t } = useTranslation('settings')
  return (
    <SettingsSection icon={Camera} title={t('snapshot.retention.title')}>
      <div className="rounded-lg border border-border bg-card p-4">
        <NumberSetting
          id="snapshot-retention-count"
          label={t('snapshot.retention.count')}
          hint={t('snapshot.retention.tip')}
          value={retentionCount}
          min={-1}
          max={100}
          presets={[3, 5, 10, 20, { value: -1, label: t('form.unlimited') }]}
          onChange={onRetentionCountChange}
        />
      </div>
    </SettingsSection>
  )
}
