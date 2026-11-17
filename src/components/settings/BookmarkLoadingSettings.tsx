import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ListPlus } from 'lucide-react'
import { SettingsSection } from './SettingsSection'
import { SettingsField } from './SettingsField'

export interface BookmarkLoadingSettingsProps {
  bookmarkInitialCount: number
  bookmarkPageSize: number
  bookmarkExpiryMinutes: number
  onBookmarkInitialCountChange: (count: number) => void
  onBookmarkPageSizeChange: (count: number) => void
  onBookmarkExpiryMinutesChange: (minutes: number) => void
}

interface NumberSettingProps {
  id: string
  label: string
  hint?: string
  value: number
  min: number
  max: number
  presets?: Array<number | { value: number; label: string }>
  onChange: (value: number) => void
}

export function NumberSetting({
  id,
  label,
  hint,
  value,
  min,
  max,
  presets = [],
  onChange,
}: NumberSettingProps) {
  const { t } = useTranslation('settings')
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const valid =
    draft.trim() !== '' &&
    Number.isInteger(Number(draft)) &&
    Number(draft) >= min &&
    Number(draft) <= max

  return (
    <SettingsField id={id} label={label} hint={hint}>
      <div className="settings-number-control flex flex-wrap items-center gap-2">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          value={draft}
          aria-describedby={hint ? `${id}-hint` : undefined}
          aria-invalid={!valid}
          onChange={(event) => {
            const next = event.target.value
            setDraft(next)
            const number = Number(next)
            if (next.trim() !== '' && Number.isInteger(number) && number >= min && number <= max) {
              onChange(number)
            }
          }}
          onBlur={() => setDraft(String(value))}
          className="settings-number-input input min-h-11 w-24 text-center"
        />
        {presets.length > 0 && (
          <div
            className="settings-choice-group"
            role="group"
            aria-label={t('form.quickValues', { name: label })}
          >
            {presets.map((preset) => {
              const option =
                typeof preset === 'number' ? { value: preset, label: String(preset) } : preset
              if (option.value < min || option.value > max) return null
              return (
                <button
                  key={option.value}
                  type="button"
                  className="settings-choice"
                  aria-pressed={valid && Number(draft) === option.value}
                  onClick={() => {
                    setDraft(String(option.value))
                    onChange(option.value)
                  }}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </SettingsField>
  )
}

export function BookmarkLoadingSettings({
  bookmarkInitialCount,
  bookmarkPageSize,
  bookmarkExpiryMinutes,
  onBookmarkInitialCountChange,
  onBookmarkPageSizeChange,
  onBookmarkExpiryMinutesChange,
}: BookmarkLoadingSettingsProps) {
  const { t } = useTranslation('settings')
  return (
    <SettingsSection icon={ListPlus} title={t('automation.bookmarkLoading.title')}>
      <div className="space-y-5 rounded-lg border border-border bg-card p-4">
        <NumberSetting
          id="bookmark-initial-count"
          label={t('automation.bookmarkLoading.initialCount')}
          value={bookmarkInitialCount}
          min={1}
          max={200}
          presets={[20, 30, 50, 100]}
          onChange={onBookmarkInitialCountChange}
        />
        <NumberSetting
          id="bookmark-page-size"
          label={t('automation.bookmarkLoading.pageSize')}
          value={bookmarkPageSize}
          min={1}
          max={200}
          presets={[10, 20, 30, 50]}
          onChange={onBookmarkPageSizeChange}
        />
        <NumberSetting
          id="bookmark-expiry-minutes"
          label={t('automation.bookmarkLoading.expiryMinutes')}
          hint={t('automation.bookmarkLoading.expiryHint')}
          value={bookmarkExpiryMinutes}
          min={0}
          max={1440}
          presets={[0, 5, 15, 30, 60]}
          onChange={onBookmarkExpiryMinutesChange}
        />
      </div>
    </SettingsSection>
  )
}
