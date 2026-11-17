import { useMemo } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { TabItemList } from '@/components/tab-groups/TabItemList'
import type { TabGroup } from '@/lib/types'
import {
  GROUP_DROP_PREFIX,
  groupItemListProps,
  type TabGroupsGridProps,
} from '@/pages/tab-groups/components/tabGroupProps'
import { TabGroupMenu, TabGroupTitle, type TabLayoutProps } from '../layouts/tab-shared'

/** 标签页看板：每个分组一列，横向滚动，标签页可在列之间拖动。 */
export function TabBoard({ groups, ...gridProps }: TabLayoutProps) {
  const folders = useMemo(
    () =>
      new Map(
        gridProps.tabGroups
          .filter((group) => group.is_folder === 1)
          .map((group) => [group.id, group.title])
      ),
    [gridProps.tabGroups]
  )
  return (
    <div className="layout-board">
      {groups.map((group) => (
        <BoardColumn
          key={group.id}
          group={group}
          folder={group.parent_id ? folders.get(group.parent_id) : undefined}
          gridProps={gridProps}
        />
      ))}
    </div>
  )
}

function BoardColumn({
  group,
  folder,
  gridProps,
}: {
  group: TabGroup
  folder?: string
  gridProps: TabGroupsGridProps
}) {
  const count = group.items?.length ?? 0
  // 有标签页的列由其中的条目接收拖放（可指定位置）；空列没有条目，整列作为放置目标
  const { setNodeRef, isOver } = useDroppable({
    id: GROUP_DROP_PREFIX + group.id,
    disabled: count > 0,
  })
  return (
    <section className="layout-board__column" data-drop-target={isOver ? 'true' : undefined}>
      <header className="layout-board__header">
        <div className="layout-board__heading">
          {folder && <span className="layout-board__folder">{folder}</span>}
          <TabGroupTitle gridProps={gridProps} group={group} />
        </div>
        <span className="layout-group-count">{count}</span>
        <TabGroupMenu gridProps={gridProps} group={group} />
      </header>
      <div ref={setNodeRef} className="layout-board__items">
        <TabItemList {...groupItemListProps(gridProps, group)} compact />
      </div>
    </section>
  )
}
