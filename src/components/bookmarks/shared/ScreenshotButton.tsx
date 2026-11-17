import { GalleryVerticalEnd } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface ScreenshotButtonProps {
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
  className?: string
  iconClassName?: string
}

/**
 * 各视图共用的“查看网站截图”小图标按钮。
 * 点击事件默认阻止冒泡，避免触发卡片自身的打开链接/批量选择。
 */
export function ScreenshotButton({
  onClick,
  className = '',
  iconClassName = 'w-4 h-4',
}: ScreenshotButtonProps) {
  const { t } = useTranslation('bookmarks')
  const label = t('screenshot.view')

  // 卡片/收藏卡自身监听 Enter/Space，这里同时截断点击和键盘冒泡，
  // 避免打开灯箱时又触发卡片自身的链接跳转。
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClick(event)
      }}
      onKeyDown={(event) => event.stopPropagation()}
      className={`bookmark-screenshot-button inline-flex items-center justify-center rounded-md transition-colors ${className}`}
    >
      <GalleryVerticalEnd className={iconClassName} strokeWidth={2} />
    </button>
  )
}
