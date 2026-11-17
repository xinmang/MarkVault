import { useMemo, useRef } from 'react'
import { useResponsiveColumns } from '@/components/bookmarks/shared/useResponsiveColumns'
import type { TabLayoutProps } from '../layouts/tab-shared'
import { wallColumns } from '../shells/grouping'
import {
  ShellGroupCard,
  TabShellFrame,
  TabShellHeader,
  folderNames,
  type TabShellProps,
} from '../shells/tab-shared'

/**
 * 卡片墙版式：没有侧栏，全部分组铺成多列瀑布流，一屏看到尽可能多的分组。
 * 标签页可以在卡片之间拖动，分组树和待办收进抽屉。
 */
export function TabsWallShell(shell: TabShellProps) {
  return (
    <TabShellFrame name="wall">
      <TabShellHeader shell={shell} />
      <div className="pshell-tabs__scroll">{shell.renderGroups(WallView)}</div>
    </TabShellFrame>
  )
}

function WallView({ groups, ...gridProps }: TabLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const columnCount = useResponsiveColumns(containerRef, {
    minColumnWidth: 300,
    gap: 16,
    maxCols: 6,
  })
  const columns = useMemo(() => wallColumns(groups, columnCount), [groups, columnCount])
  const folders = useMemo(() => folderNames(gridProps.tabGroups), [gridProps.tabGroups])
  return (
    <div
      ref={containerRef}
      className="pshell-wall"
      style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
    >
      {columns.map((column, index) => (
        <div key={index} className="pshell-wall__column">
          {column.map((group) => (
            <ShellGroupCard
              key={group.id}
              gridProps={gridProps}
              group={group}
              folder={group.parent_id ? folders.get(group.parent_id) : undefined}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
