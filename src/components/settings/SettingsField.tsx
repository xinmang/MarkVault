import type { ReactNode } from 'react'

/** 名称与控件相邻排列，说明跟随控件；窄屏按同一顺序折行。 */
export function SettingsField({
  id,
  label,
  hint,
  children,
}: {
  id?: string
  label: ReactNode
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="settings-field space-y-2">
      {id ? (
        <label htmlFor={id} className="settings-field-label text-sm font-medium">
          {label}
        </label>
      ) : (
        <div className="settings-field-label text-sm font-medium">{label}</div>
      )}
      <div className="settings-field-body space-y-1.5">
        <div className="settings-field-control">{children}</div>
        {hint && (
          <p
            id={id ? id + '-hint' : undefined}
            className="settings-field-hint text-xs text-muted-foreground"
          >
            {hint}
          </p>
        )}
      </div>
    </div>
  )
}
