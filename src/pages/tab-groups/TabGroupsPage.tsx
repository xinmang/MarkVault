import { useEffect, useState } from 'react'
import { KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { BottomNav } from '@/components/common/BottomNav'
import { Drawer } from '@/components/common/Drawer'
import { MobileHeader } from '@/components/common/MobileHeader'
import { ResizablePanel } from '@/components/common/ResizablePanel'
import { BatchActionBar } from '@/components/tab-groups/BatchActionBar'
import { MoveItemDialog } from '@/components/tab-groups/MoveItemDialog'
import { SearchBar } from '@/components/tab-groups/SearchBar'
import { ShareDialog } from '@/components/tab-groups/ShareDialog'
import { TabGroupTree } from '@/components/tab-groups/TabGroupTree'
import { TodoSidebar } from '@/components/tab-groups/TodoSidebar'
import { useBatchActions } from '@/hooks/useBatchActions'
import { usePreferences } from '@/hooks/usePreferences'
import { useToastStore } from '@/stores/toastStore'
import { useIsDesktop, useIsMobile } from '@/hooks/useMediaQuery'
import { useTabGroupActions } from '@/hooks/useTabGroupActions'
import { useTabGroupsData } from './hooks/useTabGroupsData'
import { useTabGroupItemDnD } from './hooks/useTabGroupItemDnD'
import { useTabGroupsState } from './hooks/useTabGroupsState'
import { TabGroupsGrid } from './components/TabGroupsGrid'
import type { TabGroupsGridProps } from './components/tabGroupProps'
import { useGroupManagement } from './hooks/useGroupManagement'
import {
  PLUGIN_TAB_LAYOUTS,
  availableLayouts,
  getStoredTabLayout,
  setStoredTabLayout,
  useRunningLayoutPlugins,
  type TabLayout,
} from '@/plugins/layouts'
import { usePageShell } from '@/plugins/shells'
import { TAB_SHELL_VIEWS } from '../../../plugins/builtin/shells/registry'
import { ShellSwitcher } from '../../../plugins/builtin/shells/ShellSwitcher'

export function TabGroupsPage() {
  const { t } = useTranslation('tabGroups')
  const { t: tc } = useTranslation('common')
  const state = useTabGroupsState()
  const { error: showError } = useToastStore()
  const isMobile = useIsMobile()
  const isDesktop = useIsDesktop()

  const actions = useTabGroupActions({
    setTabGroups: state.setTabGroups,
    setDeletingId: state.setDeletingId,
    setConfirmDialog: state.setConfirmDialog,
    confirmDialog: state.confirmDialog,
  })

  const batch = useBatchActions({
    tabGroups: state.tabGroups,
    setTabGroups: state.setTabGroups,
    selectedItems: state.selectedItems,
    setSelectedItems: state.setSelectedItems,
    setConfirmDialog: state.setConfirmDialog,
    confirmDialog: state.confirmDialog,
  })

  const data = useTabGroupsData({
    tabGroups: state.tabGroups,
    setTabGroups: state.setTabGroups,
    selectedGroupId: state.selectedGroupId,
    searchQuery: state.searchQuery,
    sortBy: state.sortBy,
  })

  const dnd = useTabGroupItemDnD({
    tabGroups: state.tabGroups,
    setTabGroups: state.setTabGroups,
    moveItemDialog: state.moveItemDialog,
    setMoveItemDialog: state.setMoveItemDialog,
    refreshTreeOnly: data.refreshTreeOnly,
    showError,
    moveFailedMessage: t('page.moveFailed'),
  })

  const groupMgmt = useGroupManagement({
    tabGroups: state.tabGroups,
    refreshTreeOnly: data.refreshTreeOnly,
    showError,
    batchMode: state.batchMode,
    selectedItems: state.selectedItems,
    setSelectedItems: state.setSelectedItems,
    setHighlightedDomain: state.setHighlightedDomain,
  })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  )

  const { data: preferences } = usePreferences()

  // 布局插件停用时回到默认布局，但保留选择，重新启用后恢复
  const tabLayouts = availableLayouts(
    ['default'] as const,
    PLUGIN_TAB_LAYOUTS,
    'tab-',
    useRunningLayoutPlugins()
  )
  const [storedTabLayout, setTabLayout] = useState(getStoredTabLayout)
  const tabLayout = tabLayouts.includes(storedTabLayout) ? storedTabLayout : 'default'
  const handleTabLayoutChange = (next: TabLayout) => {
    setTabLayout(next)
    setStoredTabLayout(next)
  }
  const shell = usePageShell('tabs')
  const { searchQuery, searchCleanupTimerRef, setSearchQuery } = state
  useEffect(() => {
    if (searchCleanupTimerRef.current) {
      clearTimeout(searchCleanupTimerRef.current)
      searchCleanupTimerRef.current = null
    }

    const enableAutoClear = preferences?.enable_search_auto_clear ?? true
    if (enableAutoClear && searchQuery.trim()) {
      searchCleanupTimerRef.current = setTimeout(
        () => {
          setSearchQuery('')
        },
        (preferences?.search_auto_clear_seconds ?? 15) * 1000
      )
    }

    return () => {
      if (searchCleanupTimerRef.current) {
        clearTimeout(searchCleanupTimerRef.current)
        searchCleanupTimerRef.current = null
      }
    }
  }, [
    searchQuery,
    searchCleanupTimerRef,
    setSearchQuery,
    preferences?.enable_search_auto_clear,
    preferences?.search_auto_clear_seconds,
  ])

  if (data.isLoading)
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-3">
        <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
        <p className="text-sm text-muted-foreground">{t('page.loading')}</p>
      </div>
    )

  if (data.error)
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
        <p className="text-destructive mb-4">{data.error}</p>
        <button
          onClick={() => void data.refetchTabGroups()}
          className="px-4 py-2 rounded-lg border border-border hover:bg-muted/50 transition-colors"
        >
          {tc('button.retry')}
        </button>
      </div>
    )

  // 页面的各个部分先准备好，默认骨架和页面版式插件用同一批内容各自排版
  const Shell = shell.active === 'default' ? undefined : TAB_SHELL_VIEWS[shell.active]
  const closeTree = () => state.setIsDrawerOpen(false)
  const treeProps = {
    tabGroups: state.tabGroups,
    selectedGroupId: state.selectedGroupId,
    onSelectGroup: state.setSelectedGroupId,
    onCreateFolder: groupMgmt.handleCreateFolder,
    onRenameGroup: groupMgmt.handleRenameGroup,
    onMoveGroup: groupMgmt.handleMoveGroup,
    onRefresh: data.refreshTreeOnly,
  }
  const gridProps: TabGroupsGridProps = {
    layout: tabLayout,
    tabGroups: state.tabGroups,
    filteredTabGroups: data.filteredTabGroups,
    sortedGroups: data.sortedGroups,
    selectedGroupId: state.selectedGroupId,
    searchQuery: state.searchQuery,
    activeId: dnd.activeId,
    sensors,
    highlightedDomain: state.highlightedDomain,
    selectedItems: state.selectedItems,
    batchMode: state.batchMode,
    deletingId: state.deletingId,
    editingGroupId: actions.editingGroupId,
    editingGroupTitle: actions.editingGroupTitle,
    editingItemId: actions.editingItemId,
    editingTitle: actions.editingTitle,
    onDragStart: dnd.handleDragStart,
    onDragEnd: dnd.handleDragEnd,
    onEditGroup: actions.handleEditGroup,
    onSaveGroupEdit: actions.handleSaveGroupEdit,
    onSetEditingGroupId: actions.setEditingGroupId,
    onSetEditingGroupTitle: actions.setEditingGroupTitle,
    onOpenAll: actions.handleOpenAll,
    onExportMarkdown: actions.handleExportMarkdown,
    onDelete: actions.handleDelete,
    onShareClick: state.setSharingGroupId,
    onItemClick: groupMgmt.handleItemClick,
    onEditItem: actions.handleEditItem,
    onSaveEdit: actions.handleSaveEdit,
    onTogglePin: actions.handleTogglePin,
    onToggleTodo: actions.handleToggleTodo,
    onDeleteItem: actions.handleDeleteItem,
    onMoveItem: dnd.handleMoveItem,
    onSetEditingItemId: actions.setEditingItemId,
    onSetEditingTitle: actions.setEditingTitle,
    extractDomain: groupMgmt.extractDomain,
  }
  const toolbar = state.tabGroups.length > 0 && (
    <>
      <SearchBar
        searchQuery={state.searchQuery}
        onSearchChange={state.setSearchQuery}
        sortBy={state.sortBy}
        onSortChange={state.setSortBy}
        onBatchModeToggle={() => state.setBatchMode(!state.batchMode)}
        batchMode={state.batchMode}
        layout={tabLayout}
        layouts={tabLayouts}
        onLayoutChange={handleTabLayoutChange}
      />
      <ShellSwitcher
        page="tabs"
        active={shell.active}
        available={shell.available}
        onSelect={shell.select}
        className="w-10 h-10 flex-shrink-0 flex items-center justify-center border border-border rounded hover:bg-muted transition-colors text-muted-foreground"
      />
    </>
  )
  const batchBar = state.batchMode && state.selectedItems.size > 0 && (
    <div className="mt-4">
      <BatchActionBar
        selectedCount={state.selectedItems.size}
        onSelectAll={() => {
          const allItemIds = new Set<string>()
          state.tabGroups.forEach((group) =>
            group.items?.forEach((item) => allItemIds.add(item.id))
          )
          state.setSelectedItems(allItemIds)
        }}
        onDeselectAll={batch.handleDeselectAll}
        onBatchDelete={batch.handleBatchDelete}
        onBatchPin={batch.handleBatchPin}
        onBatchTodo={batch.handleBatchTodo}
        onBatchExport={batch.handleBatchExport}
        onCancel={() => {
          state.setBatchMode(false)
          state.setSelectedItems(new Set())
        }}
      />
    </div>
  )
  const dialogs = (
    <>
      {state.sharingGroupId && (
        <ShareDialog
          groupId={state.sharingGroupId}
          groupTitle={
            state.tabGroups.find((group) => group.id === state.sharingGroupId)?.title || ''
          }
          onClose={() => state.setSharingGroupId(null)}
        />
      )}
      <MoveItemDialog
        isOpen={state.moveItemDialog.isOpen}
        itemTitle={state.moveItemDialog.item?.title || ''}
        currentGroupId={state.moveItemDialog.currentGroupId}
        availableGroups={state.tabGroups}
        onMove={dnd.handleMoveItemToGroup}
        onClose={() => state.setMoveItemDialog({ isOpen: false, item: null, currentGroupId: '' })}
      />
      <ConfirmDialog
        isOpen={state.confirmDialog.isOpen}
        title={state.confirmDialog.title}
        message={state.confirmDialog.message}
        onConfirm={state.confirmDialog.onConfirm}
        onCancel={() => state.setConfirmDialog({ ...state.confirmDialog, isOpen: false })}
      />
    </>
  )
  const treeDrawer = (
    <Drawer isOpen={state.isDrawerOpen} onClose={closeTree} title={t('title')} side="left">
      <TabGroupTree
        {...treeProps}
        onSelectGroup={(groupId) => {
          state.setSelectedGroupId(groupId)
          closeTree()
        }}
      />
    </Drawer>
  )

  if (Shell)
    return (
      <div className="w-full h-[calc(100vh-4rem)] sm:h-[calc(100vh-5rem)] flex flex-col overflow-hidden touch-none">
        {isMobile && (
          <MobileHeader
            title={t('title')}
            onMenuClick={() => state.setIsDrawerOpen(true)}
            showSearch={false}
            showMore={false}
          />
        )}
        <Shell
          grid={gridProps}
          tree={treeProps}
          toolbar={toolbar}
          batchBar={batchBar || null}
          renderGroups={(view) => <TabGroupsGrid {...gridProps} LayoutView={view} />}
          todo={<TodoSidebar tabGroups={state.tabGroups} />}
          todoCount={state.tabGroups.reduce(
            (sum, group) => sum + (group.items?.filter((item) => item.is_todo).length ?? 0),
            0
          )}
          onSelectGroup={state.setSelectedGroupId}
          onOpenTree={() => state.setIsDrawerOpen(true)}
          isMobile={isMobile}
        />
        {treeDrawer}
        {dialogs}
        {isMobile && <BottomNav />}
      </div>
    )

  return (
    <div className="w-full h-[calc(100vh-4rem)] sm:h-[calc(100vh-5rem)] flex flex-col overflow-hidden touch-none">
      <div
        className={`flex ${isMobile ? 'flex-col' : ''} w-full h-full overflow-hidden touch-none`}
      >
        {isMobile && (
          <MobileHeader
            title={t('title')}
            onMenuClick={() => state.setIsDrawerOpen(true)}
            showSearch={false}
            showMore={false}
          />
        )}
        {isDesktop ? (
          <ResizablePanel
            side="left"
            defaultWidth={240}
            minWidth={200}
            maxWidth={400}
            storageKey="tab-groups-left-sidebar-width"
          >
            <TabGroupTree {...treeProps} />
          </ResizablePanel>
        ) : (
          treeDrawer
        )}

        <div className={`flex-1 overflow-y-auto bg-muted/30 ${isMobile ? 'min-h-0' : ''}`}>
          <div className={`w-full px-4 ${isMobile ? 'py-4 pb-20' : 'py-6'}`}>
            <div className="mb-6">
              {toolbar && (
                <div className="flex items-center gap-4 w-full">
                  {!isMobile && (
                    <h1 className="text-xl font-semibold text-foreground whitespace-nowrap flex-shrink-0">
                      {t('title')}
                    </h1>
                  )}
                  <div className="flex items-center gap-2 flex-1">{toolbar}</div>
                </div>
              )}
              {batchBar}
            </div>

            <TabGroupsGrid {...gridProps} />

            {dialogs}
          </div>
        </div>

        {isDesktop && (
          <ResizablePanel
            side="right"
            defaultWidth={320}
            minWidth={280}
            maxWidth={500}
            storageKey="tab-groups-right-sidebar-width"
          >
            <TodoSidebar tabGroups={state.tabGroups} />
          </ResizablePanel>
        )}
        {isMobile && <BottomNav />}
      </div>
    </div>
  )
}
