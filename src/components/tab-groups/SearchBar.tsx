import {
  Search,
  CheckCircle,
  Archive,
  ArrowUpDown,
  ArrowDownAZ,
  ArrowDownWideNarrow,
  Calendar,
  Columns3,
  ListCollapse,
  Rows3,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { SortOption } from './sortUtils'
import { useIsMobile } from '@/hooks/useMediaQuery'
import type { TabLayout } from '@/plugins/layouts'
import { DropdownMenu } from '@/components/common/DropdownMenu'

const LAYOUT_ICONS = { default: Rows3, board: Columns3, compact: ListCollapse }
/** 排序菜单的选项与图标，键的顺序即菜单顺序 */
const SORT_ICONS = { created: Calendar, title: ArrowDownAZ, count: ArrowDownWideNarrow }
const SORT_OPTIONS = Object.keys(SORT_ICONS) as SortOption[]

const MENU_BUTTON_CLASS =
  'w-10 h-10 flex-shrink-0 flex items-center justify-center border border-border rounded hover:bg-muted transition-colors text-muted-foreground'

interface SearchBarProps {
  searchQuery: string
  onSearchChange: (query: string) => void
  sortBy: SortOption
  onSortChange: (sort: SortOption) => void
  onBatchModeToggle: () => void
  batchMode: boolean
  layout?: TabLayout
  /** 当前可切换的布局；启用了标签页布局插件（多于一种）时才显示布局菜单 */
  layouts?: readonly TabLayout[]
  onLayoutChange?: (layout: TabLayout) => void
}

export function SearchBar({
  searchQuery,
  onSearchChange,
  sortBy,
  onSortChange,
  onBatchModeToggle,
  batchMode,
  layout = 'default',
  layouts,
  onLayoutChange,
}: SearchBarProps) {
  const { t } = useTranslation('tabGroups')
  const isMobile = useIsMobile()
  const LayoutIcon = LAYOUT_ICONS[layout]

  const currentSortLabel = t('sort.' + sortBy)
  const currentLayoutLabel = t('layout.switch', { name: t('layout.' + layout) })

  return (
    <div className="flex items-center gap-2 flex-1">
      {/* Search Input */}
      <div className="flex-1 relative min-w-0">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <input
          type="text"
          placeholder={t('search.placeholder')}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="input w-full !pl-11"
        />
      </div>

      {/* 排序菜单 - 仅图标 */}
      <DropdownMenu
        trigger={
          <button
            type="button"
            className={`${MENU_BUTTON_CLASS} bg-card`}
            title={currentSortLabel}
            aria-label={currentSortLabel}
            aria-haspopup="menu"
          >
            <ArrowUpDown className="w-5 h-5" aria-hidden="true" />
          </button>
        }
        items={SORT_OPTIONS.map((option) => {
          const Icon = SORT_ICONS[option]
          return {
            label: t('sort.' + option),
            icon: <Icon className="w-4 h-4" aria-hidden="true" />,
            selected: option === sortBy,
            onClick: () => {
              if (option !== sortBy) onSortChange(option)
            },
          }
        })}
      />

      {/* 布局菜单 - 只有一种布局可用时不显示 */}
      {onLayoutChange && layouts && layouts.length > 1 && (
        <DropdownMenu
          trigger={
            <button
              type="button"
              className={MENU_BUTTON_CLASS}
              title={currentLayoutLabel}
              aria-label={currentLayoutLabel}
              aria-haspopup="menu"
            >
              <LayoutIcon className="w-5 h-5" aria-hidden="true" />
            </button>
          }
          items={layouts.map((name) => {
            const Icon = LAYOUT_ICONS[name]
            return {
              label: t('layout.' + name),
              icon: <Icon className="w-4 h-4" aria-hidden="true" />,
              selected: name === layout,
              onClick: () => {
                if (name !== layout) onLayoutChange(name)
              },
            }
          })}
        />
      )}

      {/* Batch Mode Toggle - Icon Only */}
      <button
        onClick={onBatchModeToggle}
        className={`w-10 h-10 flex-shrink-0 flex items-center justify-center rounded transition-colors ${
          batchMode
            ? 'bg-primary text-primary-foreground'
            : 'border border-border hover:bg-muted text-muted-foreground'
        }`}
        title={batchMode ? t('batch.exit') : t('batch.enter')}
      >
        <CheckCircle className="w-5 h-5" />
      </button>

      {/* Trash Link - 移动端隐藏（在底部导航） */}
      {!isMobile && (
        <Link
          to="/tab/trash"
          className="w-10 h-10 flex-shrink-0 flex items-center justify-center border border-border rounded hover:bg-muted transition-colors text-muted-foreground"
          title={t('trash.title')}
        >
          <Archive className="w-5 h-5" />
        </Link>
      )}
    </div>
  )
}
