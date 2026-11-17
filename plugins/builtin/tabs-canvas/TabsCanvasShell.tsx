import { useMemo } from 'react'
import { InfiniteCanvas, type CanvasItem } from '../canvas/InfiniteCanvas'
import type { TabLayoutProps } from '../layouts/tab-shared'
import {
  ShellGroupCard,
  TabShellFrame,
  TabShellHeader,
  folderNames,
  type TabShellProps,
} from '../shells/tab-shared'

/** 卡片高度在测量之前的估计值，只影响首帧排布。 */
const HEADER_HEIGHT = 52
const ITEM_HEIGHT = 46

/**
 * 无限画布版式：每个标签页组是画布上的一张卡片，分组再多也能全部摊开。
 * 拖动空白处平移，Ctrl + 滚轮缩放；标签页仍可在卡片之间拖动，分组树和待办收进抽屉。
 */
export function TabsCanvasShell(shell: TabShellProps) {
  return (
    <TabShellFrame name="canvas">
      <TabShellHeader shell={shell} />
      <div className="pcanvas-tabs__body">{shell.renderGroups(CanvasView)}</div>
    </TabShellFrame>
  )
}

function CanvasView({ groups, ...gridProps }: TabLayoutProps) {
  const folders = useMemo(() => folderNames(gridProps.tabGroups), [gridProps.tabGroups])
  const items: CanvasItem[] = groups.map((group) => ({
    id: group.id,
    label: group.title,
    estimatedHeight: HEADER_HEIGHT + 16 + Math.max(1, group.items?.length ?? 0) * ITEM_HEIGHT,
    content: (
      <ShellGroupCard
        gridProps={gridProps}
        group={group}
        folder={group.parent_id ? folders.get(group.parent_id) : undefined}
      />
    ),
  }))
  return <InfiniteCanvas storageKey="tabs" items={items} columnWidth={340} />
}
