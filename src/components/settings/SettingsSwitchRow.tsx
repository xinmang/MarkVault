import type { ReactNode } from 'react'
import { useId } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Toggle } from '@/components/common/Toggle'
import { SettingsItem, SettingsSection } from './SettingsSection'
import { useDefaultManagementTheme } from './useDefaultManagementTheme'

interface SettingsSwitchRowProps {
  title: string
  description?: string
  icon?: LucideIcon
  checked: boolean
  onChange: (checked: boolean) => void
  ariaLabel?: string
}

/** 默认主题把说明与开关放在同一行，整行可点击，长说明按可用宽度换行。 */
export function SettingsSwitchRow({
  title,
  description,
  icon: Icon,
  checked,
  onChange,
  ariaLabel,
}: SettingsSwitchRowProps) {
  const compact = useDefaultManagementTheme()
  const descriptionId = useId()
  if (!compact)
    return (
      <SettingsItem
        title={title}
        description={description}
        icon={Icon}
        action={<Toggle checked={checked} onChange={onChange} ariaLabel={ariaLabel ?? title} />}
      />
    )
  return (
    <label className="settings-switch-row">
      {Icon && <Icon className="settings-switch-icon" aria-hidden="true" />}
      <span className="settings-switch-copy">
        <span className="settings-switch-title">{title}</span>
        {description && (
          <span id={descriptionId} className="settings-switch-description">
            {description}
          </span>
        )}
      </span>
      <input
        className="peer sr-only"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={ariaLabel ?? title}
        aria-describedby={description ? descriptionId : undefined}
      />
      <span
        className="settings-toggle peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-primary"
        data-state={checked ? 'on' : 'off'}
        aria-hidden="true"
      >
        <span className="settings-toggle__thumb" />
      </span>
    </label>
  )
}

interface SettingsSwitchSectionProps extends SettingsSwitchRowProps {
  enableLabel: string
  enableDescription?: string
  children?: ReactNode
  framed?: boolean
  optionsOnly?: boolean
}

/** 合并重复的区块标题和启用卡片；主题插件继续使用原有分层布局。 */
export function SettingsSwitchSection({
  title,
  description,
  icon,
  checked,
  onChange,
  enableLabel,
  enableDescription,
  children,
  framed = false,
  optionsOnly = false,
}: SettingsSwitchSectionProps) {
  const compact = useDefaultManagementTheme()
  if (optionsOnly) return <div className="settings-plugin-options">{children}</div>
  if (!compact)
    return (
      <SettingsSection title={title} description={description} icon={icon}>
        <div
          className={framed ? 'space-y-4 rounded-lg border border-border bg-card p-4' : 'space-y-3'}
        >
          <SettingsItem
            title={enableLabel}
            description={enableDescription}
            action={<Toggle checked={checked} onChange={onChange} ariaLabel={enableLabel} />}
          />
          {children}
        </div>
      </SettingsSection>
    )
  return (
    <section className="settings-switch-section" aria-label={title}>
      <SettingsSwitchRow
        title={title}
        description={enableDescription ?? description}
        icon={icon}
        checked={checked}
        onChange={onChange}
        ariaLabel={enableLabel}
      />
      {children && <div className="settings-switch-content">{children}</div>}
    </section>
  )
}
