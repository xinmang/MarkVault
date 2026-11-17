import { useTranslation } from 'react-i18next'
import { LayoutTemplate } from 'lucide-react'
import { DropdownMenu } from '@/components/common/DropdownMenu'
import type { ShellPage } from '@/plugins/shells'
import { SHELL_ICONS } from './registry'

/**
 * 页面上的版式切换按钮：列出默认骨架和正在运行的版式插件。
 * 没有启用任何版式插件时不显示。
 */
export function ShellSwitcher({
  page,
  active,
  available,
  onSelect,
  className,
}: {
  page: ShellPage
  active: string
  available: readonly string[]
  onSelect: (name: string) => void
  className: string
}) {
  const { t } = useTranslation('plugins')
  if (available.length === 0) return null
  const label = t('shells.switch', { name: t(`shells.${page}.${active}.name`) })
  return (
    <DropdownMenu
      trigger={
        <button
          type="button"
          className={className}
          title={label}
          aria-label={label}
          aria-haspopup="menu"
        >
          <LayoutTemplate className="w-4 h-4 lg:w-5 lg:h-5" aria-hidden="true" />
        </button>
      }
      items={['default', ...available].map((name) => {
        const Icon = SHELL_ICONS[page][name]!
        return {
          label: t(`shells.${page}.${name}.name`),
          icon: <Icon className="w-4 h-4" aria-hidden="true" />,
          selected: name === active,
          onClick: () => onSelect(name),
        }
      })}
    />
  )
}
