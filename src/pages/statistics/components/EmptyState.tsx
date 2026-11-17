interface EmptyStateProps {
  message: string
  /** 紧凑版：用在图表内部，不额外撑高容器 */
  compact?: boolean
}

/** 各卡片共用的空状态：只渲染文案，不包含任何图标色相 */
export function EmptyState({ message, compact = false }: EmptyStateProps) {
  return (
    <div
      className={`flex items-center justify-center text-center text-muted-foreground ${
        compact ? 'h-full py-6 text-[11.5px]' : 'py-8 text-xs'
      }`}
    >
      <span>{message}</span>
    </div>
  )
}
