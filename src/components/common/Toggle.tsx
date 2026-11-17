interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  label?: string
  description?: string
  ariaLabel?: string
}

export function Toggle({
  checked,
  onChange,
  disabled = false,
  label,
  description,
  ariaLabel,
}: ToggleProps) {
  return (
    <label
      className={`relative inline-flex min-h-11 items-center ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        aria-label={ariaLabel ?? label}
        className="peer sr-only"
      />
      <span
        className={`settings-toggle peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-primary ${disabled ? 'is-disabled' : ''}`}
        data-state={checked ? 'on' : 'off'}
        aria-hidden="true"
      >
        <span className="settings-toggle__thumb" />
      </span>
      {(label || description) && (
        <div className="ml-3">
          {label && <div className="text-sm font-medium text-foreground">{label}</div>}
          {description && <div className="text-xs text-muted-foreground">{description}</div>}
        </div>
      )}
    </label>
  )
}
