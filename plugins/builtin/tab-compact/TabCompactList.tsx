import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { TabItemList } from '@/components/tab-groups/TabItemList'
import type { TabGroup, TabGroupItem } from '@/lib/types'
import {
  groupItemListProps,
  type TabGroupsGridProps,
} from '@/pages/tab-groups/components/tabGroupProps'
import { TabGroupMenu, TabGroupTitle, type TabLayoutProps } from '../layouts/tab-shared'

const PREVIEW_COUNT = 6

/** 标签页折叠列表：每个分组收成一行，点击展开；搜索时自动展开命中的分组。 */
export function TabCompactList({ groups, ...gridProps }: TabLayoutProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const searching = gridProps.searchQuery.trim() !== ''
  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  return (
    <div className="layout-compact">
      {groups.map((group) => (
        <CompactGroup
          key={group.id}
          group={group}
          open={searching || expanded.has(group.id)}
          onToggle={() => toggle(group.id)}
          gridProps={gridProps}
        />
      ))}
    </div>
  )
}

function CompactGroup({
  group,
  open,
  onToggle,
  gridProps,
}: {
  group: TabGroup
  open: boolean
  onToggle: () => void
  gridProps: TabGroupsGridProps
}) {
  const items = group.items ?? []
  const editing = gridProps.editingGroupId === group.id
  return (
    <section className="layout-compact__group">
      <div className="layout-compact__header">
        <button
          type="button"
          className="layout-compact__toggle"
          data-editing={editing ? 'true' : undefined}
          aria-expanded={open}
          aria-label={editing ? group.title : undefined}
          onClick={onToggle}
        >
          <ChevronDown className="layout-chevron" size={16} aria-hidden="true" />
          {!editing && (
            <>
              <TabGroupTitle gridProps={gridProps} group={group} />
              <span className="layout-group-count">{items.length}</span>
              {!open && <FaviconStack items={items} extractDomain={gridProps.extractDomain} />}
            </>
          )}
        </button>
        {editing && <TabGroupTitle gridProps={gridProps} group={group} />}
        <TabGroupMenu gridProps={gridProps} group={group} />
      </div>
      {open && (
        <div className="layout-compact__items">
          <TabItemList {...groupItemListProps(gridProps, group)} />
        </div>
      )}
    </section>
  )
}

function FaviconStack({
  items,
  extractDomain,
}: {
  items: TabGroupItem[]
  extractDomain: (url: string) => string
}) {
  if (items.length === 0) return null
  return (
    <span className="layout-compact__favicons" aria-hidden="true">
      {items.slice(0, PREVIEW_COUNT).map((item) => (
        <img
          key={item.id}
          src={
            item.favicon ||
            `https://www.google.com/s2/favicons?domain=${extractDomain(item.url)}&sz=32`
          }
          alt=""
          loading="lazy"
          onError={(event) => {
            event.currentTarget.style.visibility = 'hidden'
          }}
        />
      ))}
      {items.length > PREVIEW_COUNT && <span>+{items.length - PREVIEW_COUNT}</span>}
    </span>
  )
}
