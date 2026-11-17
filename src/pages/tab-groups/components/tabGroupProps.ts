import type { ComponentType } from 'react'
import type { DndContext } from '@dnd-kit/core'
import type { TabGroup, TabGroupItem } from '@/lib/types'
import type { TabLayout } from '@/plugins/layouts'

/** 空分组整体作为拖放目标时的 ID 前缀，与标签页条目的 ID 区分。 */
export const GROUP_DROP_PREFIX = 'group:'

export interface TabGroupsGridProps {
  tabGroups: TabGroup[]
  filteredTabGroups: TabGroup[]
  sortedGroups: TabGroup[]
  selectedGroupId: string | null
  searchQuery: string
  /** 标签页组的展示布局；board 与 compact 由布局插件提供 */
  layout?: TabLayout
  /** 页面版式插件自带的分组排列方式，传入后优先于 layout */
  LayoutView?: ComponentType<TabGroupsGridProps & { groups: TabGroup[] }>
  activeId: string | null
  sensors: Parameters<typeof DndContext>[0]['sensors']
  highlightedDomain: string | null
  selectedItems: Set<string>
  batchMode: boolean
  deletingId: string | null
  editingGroupId: string | null
  editingGroupTitle: string
  editingItemId: string | null
  editingTitle: string
  onDragStart: Parameters<typeof DndContext>[0]['onDragStart']
  onDragEnd: Parameters<typeof DndContext>[0]['onDragEnd']
  onEditGroup: (group: TabGroup) => void
  onSaveGroupEdit: (groupId: string) => void
  onSetEditingGroupId: (id: string | null) => void
  onSetEditingGroupTitle: (title: string) => void
  onOpenAll: (items: TabGroupItem[]) => void
  onExportMarkdown: (group: TabGroup) => void
  onDelete: (id: string, title: string) => void
  onShareClick: (id: string) => void
  onItemClick: (item: TabGroupItem, e: React.MouseEvent | React.ChangeEvent<HTMLInputElement>) => void
  onEditItem: (item: TabGroupItem) => void
  onSaveEdit: (groupId: string, itemId: string) => void
  onTogglePin: (groupId: string, itemId: string, currentPinned: boolean) => void
  onToggleTodo: (groupId: string, itemId: string, currentTodo: boolean) => void
  onDeleteItem: (groupId: string, itemId: string, title: string) => void
  onMoveItem: (item: TabGroupItem) => void
  onSetEditingItemId: (id: string | null) => void
  onSetEditingTitle: (title: string) => void
  extractDomain: (url: string) => string
}

/** 各布局共用：把页面级回调收拢成单个分组头部需要的属性。 */
export function groupHeaderProps(props: TabGroupsGridProps, group: TabGroup) {
  return {
    group,
    isEditingTitle: props.editingGroupId === group.id,
    editingTitle: props.editingGroupTitle,
    onEditTitle: () => props.onEditGroup(group),
    onSaveTitle: () => props.onSaveGroupEdit(group.id),
    onCancelEdit: () => {
      props.onSetEditingGroupId(null)
      props.onSetEditingGroupTitle('')
    },
    onTitleChange: props.onSetEditingGroupTitle,
    onOpenAll: () => props.onOpenAll(group.items || []),
    onExport: () => props.onExportMarkdown(group),
    onDelete: () => props.onDelete(group.id, group.title),
    isDeleting: props.deletingId === group.id,
    onShareClick: () => props.onShareClick(group.id),
  }
}

/** 各布局共用：单个分组内标签页列表需要的属性。 */
export function groupItemListProps(props: TabGroupsGridProps, group: TabGroup) {
  return {
    items: group.items || [],
    groupId: group.id,
    highlightedDomain: props.highlightedDomain,
    selectedItems: props.selectedItems,
    batchMode: props.batchMode,
    editingItemId: props.editingItemId,
    editingTitle: props.editingTitle,
    onItemClick: props.onItemClick,
    onEditItem: props.onEditItem,
    onSaveEdit: props.onSaveEdit,
    onTogglePin: props.onTogglePin,
    onToggleTodo: props.onToggleTodo,
    onDeleteItem: props.onDeleteItem,
    onMoveItem: props.onMoveItem,
    setEditingItemId: props.onSetEditingItemId,
    setEditingTitle: props.onSetEditingTitle,
    extractDomain: props.extractDomain,
  }
}
