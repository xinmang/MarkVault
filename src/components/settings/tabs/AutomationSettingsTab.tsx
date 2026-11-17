import { useTranslation } from 'react-i18next'
import { Search, Tag } from 'lucide-react'
import { SettingsSwitchSection } from '../SettingsSwitchRow'
import {
  BookmarkLoadingSettings,
  NumberSetting,
  type BookmarkLoadingSettingsProps,
} from '../BookmarkLoadingSettings'

interface AutomationSettingsTabProps extends BookmarkLoadingSettingsProps {
  searchEnabled: boolean
  searchSeconds: number
  tagEnabled: boolean
  tagSeconds: number
  onSearchEnabledChange: (enabled: boolean) => void
  onSearchSecondsChange: (seconds: number) => void
  onTagEnabledChange: (enabled: boolean) => void
  onTagSecondsChange: (seconds: number) => void
}

export function AutomationSettingsTab({
  searchEnabled,
  searchSeconds,
  tagEnabled,
  tagSeconds,
  onSearchEnabledChange,
  onSearchSecondsChange,
  onTagEnabledChange,
  onTagSecondsChange,
  ...bookmarkLoadingProps
}: AutomationSettingsTabProps) {
  const { t } = useTranslation('settings')
  return (
    <div className="space-y-6">
      <BookmarkLoadingSettings {...bookmarkLoadingProps} />
      <SettingsSwitchSection
        icon={Search}
        title={t('automation.search.title')}
        enableLabel={t('automation.search.enable')}
        enableDescription={t('automation.search.enableHint')}
        checked={searchEnabled}
        onChange={onSearchEnabledChange}
      >
        {searchEnabled && (
          <div className="rounded-lg border border-border p-4">
            <NumberSetting
              id="search-auto-clear-seconds"
              label={t('automation.delaySeconds')}
              value={searchSeconds}
              min={5}
              max={120}
              presets={[5, 15, 30, 60]}
              onChange={onSearchSecondsChange}
            />
          </div>
        )}
      </SettingsSwitchSection>
      <SettingsSwitchSection
        icon={Tag}
        title={t('automation.tag.title')}
        enableLabel={t('automation.tag.enable')}
        enableDescription={t('automation.tag.enableHint')}
        checked={tagEnabled}
        onChange={onTagEnabledChange}
      >
        {tagEnabled && (
          <div className="rounded-lg border border-border p-4">
            <NumberSetting
              id="tag-auto-clear-seconds"
              label={t('automation.delaySeconds')}
              value={tagSeconds}
              min={10}
              max={300}
              presets={[10, 30, 60, 120]}
              onChange={onTagSecondsChange}
            />
          </div>
        )}
      </SettingsSwitchSection>
    </div>
  )
}
