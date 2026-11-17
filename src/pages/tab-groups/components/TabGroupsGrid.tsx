import { DndContext, DragOverlay, closestCenter } from '@dnd-kit/core'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '@/components/tab-groups/EmptyState'
import { PinnedItemsSection } from '@/components/tab-groups/PinnedItemsSection'
import { TabGroupHeader } from '@/components/tab-groups/TabGroupHeader'
import { TabItemList } from '@/components/tab-groups/TabItemList'
import type { TabGroup } from '@/lib/types'
import { TabBoard } from '../../../../plugins/builtin/tab-board/TabBoard'
import { TabCompactList } from '../../../../plugins/builtin/tab-compact/TabCompactList'
import { groupHeaderProps, groupItemListProps, type TabGroupsGridProps } from './tabGroupProps'

function renderGroupCard(props: TabGroupsGridProps, group: TabGroup) {
  return (
    <div key={group.id} className="card border-l-[3px] border-l-primary p-6 hover:shadow-xl transition-all duration-200">
      <TabGroupHeader {...groupHeaderProps(props, group)} />

      {group.items && group.items.length > 0 && (
        <TabItemList {...groupItemListProps(props, group)} />
      )}
    </div>
  )
}

export function TabGroupsGrid(props: TabGroupsGridProps) {
  const { t } = useTranslation('tabGroups')
  const {
    tabGroups,
    filteredTabGroups,
    sortedGroups,
    selectedGroupId,
    searchQuery,
    activeId,
    sensors,
    onDragStart,
    onDragEnd,
    layout = 'default',
    LayoutView,
  } = props
  // 插件布局不按文件夹分节，文件夹名由布局自行标注
  const flatGroups = sortedGroups.filter((group) => group.is_folder !== 1)

  if (tabGroups.length === 0) {
    return <EmptyState isSearching={false} searchQuery="" />
  }

  if (filteredTabGroups.length === 0) {
    return <EmptyState isSearching={true} searchQuery={searchQuery} />
  }

  return (
    <>
      {!searchQuery && sortedGroups.length > 0 && (
        <PinnedItemsSection
          tabGroups={sortedGroups}
          onUnpin={(groupId, itemId) => props.onTogglePin(groupId, itemId, true)}
        />
      )}

      {sortedGroups.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >
          {LayoutView ? (
            <LayoutView {...props} groups={flatGroups} />
          ) : layout === 'board' ? (
            <TabBoard {...props} groups={flatGroups} />
          ) : layout === 'compact' ? (
            <TabCompactList {...props} groups={flatGroups} />
          ) : (
          <div className="grid grid-cols-1 gap-6">
            {(() => {
              const groupsByParent = new Map<string | null, TabGroup[]>()
              sortedGroups.forEach((group) => {
                const parentId = group.parent_id || null
                const groups = groupsByParent.get(parentId) || []
                groups.push(group)
                groupsByParent.set(parentId, groups)
              })

              const cards: JSX.Element[] = []
              if (selectedGroupId) {
                sortedGroups.forEach((group) => {
                  if (group.is_folder !== 1) {
                    cards.push(renderGroupCard(props, group))
                  }
                })
                return cards
              }

              const rootGroups = groupsByParent.get(null) || []
              rootGroups.forEach((group) => {
                if (group.is_folder === 1) {
                  const children = groupsByParent.get(group.id) || []
                  if (children.length > 0) {
                    cards.push(
                      <div key={`folder-${group.id}`} className="mt-6 first:mt-0">
                        <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                          <span>📁</span>
                          <span>{group.title}</span>
                          <span className="text-sm text-muted-foreground">
                            {t('header.tabCount', {
                              count: children.reduce((sum, entry) => sum + (entry.item_count || 0), 0),
                            })}
                          </span>
                        </h2>
                        <div className="space-y-6">
                          {children.map((childGroup) => renderGroupCard(props, childGroup))}
                        </div>
                      </div>
                    )
                  }
                } else {
                  cards.push(renderGroupCard(props, group))
                }
              })

              return cards
            })()}
          </div>
          )}

          <DragOverlay>
            {activeId ? (
              <div
                className="bg-card border-2 border-primary rounded shadow-xl cursor-grabbing p-3 opacity-95"
                style={{ transform: 'scale(1.05)' }}
              >
                {(() => {
                  for (const group of tabGroups) {
                    const item = group.items?.find((entry) => entry.id === activeId)
                    if (item) {
                      return (
                        <div className="flex items-center gap-3">
                          <div className="w-4 h-4 rounded bg-primary/20 flex-shrink-0" />
                          <span className="text-sm font-medium text-foreground truncate max-w-[300px]">
                            {item.title}
                          </span>
                        </div>
                      )
                    }
                  }
                  return null
                })()}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </>
  )
}
