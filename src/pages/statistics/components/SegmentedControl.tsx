import type { ReactNode } from 'react'

export interface SegmentedOption<T extends string> {
  value: T
  /** 可见文案；只给图标时留空 */
  label?: string
  icon?: ReactNode
  /** 图标按钮的无障碍名称 */
  ariaLabel?: string
  disabled?: boolean
  /** 禁用原因（作为 title 提示） */
  title?: string
}

interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  /** 整组的无障碍名称 */
  ariaLabel: string
  className?: string
}

/**
 * 分段控件：一组互斥按钮，用 aria-pressed 表达选中态。
 * 只使用应用 token，颜色不来自序列色板。
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className = '',
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-border bg-muted p-0.5 ${className}`}
    >
      {options.map((option) => {
        const pressed = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={pressed}
            aria-label={option.ariaLabel}
            title={option.title ?? option.ariaLabel ?? option.label}
            disabled={option.disabled}
            onClick={() => {
              if (option.value !== value) onChange(option.value)
            }}
            className={`inline-flex items-center gap-1 rounded-[6px] px-2 py-1 text-[11.5px] leading-4 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-45 ${
              pressed
                ? 'bg-card font-medium text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {option.icon}
            {option.label ? <span>{option.label}</span> : null}
          </button>
        )
      })}
    </div>
  )
}
