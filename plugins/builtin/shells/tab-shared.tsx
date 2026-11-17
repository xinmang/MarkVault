/* eslint-disable react-refresh/only-export-components */
import { useState, type ComponentProps, type ComponentType, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useDroppable } from '@dnd-kit/core'
import { FolderTree, ListTodo } from 'lucide-react'
import type { TabGroup } from '@/lib/types'
import { Drawer } from '@/components/common/Drawer'
import { TabItemList } from '@/components/tab-groups/TabItemList'
import type { TabGroupTree } from '@/components/tab-groups/TabGroupTree'
import {
  GROUP_DROP_PREFIX,
  groupItemListProps,
  type TabGroupsGridProps,
} from '@/pages/tab-groups/components/tabGroupProps'
import type { PluginTabShell } from '@/plugins/shells'
import { TabGroupMenu, TabGroupTitle, type TabLayoutProps } from '../layouts/tab-shared'
import './style.css'

/**
 * 标签页组版式插件收到的属性：页面已经准备好的各个部分，加上原始数据与回调。
 * 版式决定分组导航、工具栏、分组内容和待办放在哪里；弹窗与手机端导航仍由页面负责。
 */
export interface TabShellProps {
  /** 页面级数据与回调，与标签页组布局插件收到的相同 */
  grid: TabGroupsGridProps
  /** 分组树需要的属性（新建文件夹、重命名、拖动排序） */
  tree: ComponentProps<typeof TabGroupTree>
  /** 搜索、排序、布局切换和批量模式 */
  toolbar: ReactNode
  /** 批量操作栏；没有选中标签页时为 null */
  batchBar: ReactNode
  /**
   * 渲染全部分组，包含置顶区、拖放和空状态。
   * 不传参数时使用用户当前选择的标签页组布局，传入组件则由版式自己排列分组。
   */
  renderGroups: (view?: ComponentType<TabLayoutProps>) => ReactNode
  /** 待办面板 */
  todo: ReactNode
  todoCount: number
  onSelectGroup: (groupId: string | null) => void
  /** 在抽屉里打开分组树 */
  onOpenTree: () => void
  isMobile: boolean
}

export function TabShellFrame({ name, children }: { name: PluginTabShell; children: ReactNode }) {
  return <div className={'pshell-tabs pshell-tabs--' + name}>{children}</div>
}

/**
 * 版式共用的页头：标题、工具栏，以及打开分组树和待办抽屉的按钮。
 * 默认骨架里常驻两侧的面板在这里收进抽屉，把宽度留给标签页。
 */
export function TabShellHeader({
  shell,
  showTreeButton = true,
}: {
  shell: TabShellProps
  showTreeButton?: boolean
}) {
  const { t } = useTranslation('tabGroups')
  const { t: tp } = useTranslation('plugins')
  const [todoOpen, setTodoOpen] = useState(false)
  return (
    <div className="pshell-tabs__header">
      <div className="pshell-tabs__bar">
        {!shell.isMobile && <h1 className="pshell-tabs__title">{t('title')}</h1>}
        {shell.toolbar}
        {/* 手机宽度下分组树由页面顶部的菜单按钮打开 */}
        {showTreeButton && !shell.isMobile && (
          <button
            type="button"
            className="pshell-tabs__button"
            onClick={shell.onOpenTree}
            title={tp('shells.manageGroups')}
            aria-label={tp('shells.manageGroups')}
          >
            <FolderTree size={18} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className="pshell-tabs__button"
          onClick={() => setTodoOpen(true)}
          title={t('todo.title')}
          aria-label={t('todo.title')}
        >
          <ListTodo size={18} aria-hidden="true" />
          {shell.todoCount > 0 && <span className="pshell-tabs__badge">{shell.todoCount}</span>}
        </button>
      </div>
      {shell.batchBar}
      <Drawer isOpen={todoOpen} onClose={() => setTodoOpen(false)} side="right">
        {shell.todo}
      </Drawer>
    </div>
  )
}

/** 文件夹 ID 到名称的对应表，卡片上用来标注分组所在的文件夹。 */
export function folderNames(tabGroups: readonly TabGroup[]): Map<string, string> {
  return new Map(
    tabGroups.filter((group) => group.is_folder === 1).map((group) => [group.id, group.title])
  )
}

/**
 * 版式自绘的分组卡片：标题、数量、操作菜单和可拖放的标签页列表。
 * 空分组整体作为放置目标，与看板布局的规则一致。
 */
export function ShellGroupCard({
  gridProps,
  group,
  folder,
  meta,
  compact = true,
}: {
  gridProps: TabGroupsGridProps
  group: TabGroup
  folder?: string
  /** 标题旁的补充信息，例如收纳时间 */
  meta?: ReactNode
  compact?: boolean
}) {
  const count = group.items?.length ?? 0
  const { setNodeRef, isOver } = useDroppable({
    id: GROUP_DROP_PREFIX + group.id,
    disabled: count > 0,
  })
  return (
    <section className="pshell-group" data-drop-target={isOver ? 'true' : undefined}>
      <header className="pshell-group__header">
        <div className="pshell-group__heading">
          {folder && <span className="pshell-group__folder">{folder}</span>}
          <TabGroupTitle gridProps={gridProps} group={group} />
        </div>
        {meta && <span className="pshell-group__meta">{meta}</span>}
        <span className="pshell-count">{count}</span>
        <TabGroupMenu gridProps={gridProps} group={group} />
      </header>
      <div ref={setNodeRef} className="pshell-group__items">
        <TabItemList {...groupItemListProps(gridProps, group)} compact={compact} />
      </div>
    </section>
  )
}
