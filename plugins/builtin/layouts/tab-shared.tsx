import { useTranslation } from 'react-i18next'
import { Check, Download, Edit2, FolderOpen, MoreVertical, Share2, Trash2, X } from 'lucide-react'
import type { TabGroup } from '@/lib/types'
import { DropdownMenu } from '@/components/common/DropdownMenu'
import {
  groupHeaderProps,
  type TabGroupsGridProps,
} from '@/pages/tab-groups/components/tabGroupProps'
import './style.css'

/** 标签页组布局插件收到的属性：页面级回调，加上已排序并去掉文件夹的分组。 */
export type TabLayoutProps = TabGroupsGridProps & { groups: TabGroup[] }

interface GroupPartProps {
  gridProps: TabGroupsGridProps
  group: TabGroup
}

/** 分组标题；重命名时原地换成输入框，回车保存、Esc 取消。 */
export function TabGroupTitle({ gridProps, group }: GroupPartProps) {
  const { t } = useTranslation('common')
  const header = groupHeaderProps(gridProps, group)
  if (!header.isEditingTitle) {
    return (
      <span className="layout-tab-title" title={group.title}>
        {group.title}
      </span>
    )
  }
  return (
    <span className="layout-tab-title-edit">
      <input
        type="text"
        className="input"
        value={header.editingTitle}
        autoFocus
        onChange={(event) => header.onTitleChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') header.onSaveTitle()
          else if (event.key === 'Escape') header.onCancelEdit()
        }}
      />
      <button type="button" onClick={header.onSaveTitle} title={t('button.save')}>
        <Check size={16} aria-hidden="true" />
      </button>
      <button type="button" onClick={header.onCancelEdit} title={t('button.cancel')}>
        <X size={16} aria-hidden="true" />
      </button>
    </span>
  )
}

/** 分组操作收进一个菜单，窄列和单行里不再平铺四个按钮。 */
export function TabGroupMenu({ gridProps, group }: GroupPartProps) {
  const { t } = useTranslation('tabGroups')
  const header = groupHeaderProps(gridProps, group)
  const empty = !group.items?.length
  return (
    <DropdownMenu
      trigger={
        <button
          type="button"
          className="layout-tab-menu"
          title={t('layout.groupActions')}
          aria-label={t('layout.groupActions')}
        >
          <MoreVertical size={16} aria-hidden="true" />
        </button>
      }
      items={[
        { label: t('action.rename'), icon: <Edit2 className="w-4 h-4" />, onClick: header.onEditTitle },
        {
          label: t('action.openAll'),
          icon: <FolderOpen className="w-4 h-4" />,
          onClick: header.onOpenAll,
          disabled: empty,
        },
        {
          label: t('action.export'),
          icon: <Download className="w-4 h-4" />,
          onClick: header.onExport,
          disabled: empty,
        },
        { label: t('action.share'), icon: <Share2 className="w-4 h-4" />, onClick: header.onShareClick },
        {
          label: header.isDeleting ? t('action.deleting') : t('action.delete'),
          icon: <Trash2 className="w-4 h-4" />,
          onClick: header.onDelete,
          disabled: header.isDeleting,
          danger: true,
          divider: true,
        },
      ]}
    />
  )
}
