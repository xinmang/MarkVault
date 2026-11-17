import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useTags, useCreateTag } from '@/hooks/useTags'
import { useRecordTagClick } from '@/hooks/useClickTracking'
import type { Bookmark, Tag, TagSortPreference } from '@/lib/types'
import { Cloud, ChartBarDecreasing } from 'lucide-react'
import {
  CORE_TAG_LAYOUTS,
  PLUGIN_TAG_LAYOUTS,
  type PluginTagLayout,
  type TagLayout,
} from '@/lib/constants/bookmarks'
import { availableLayouts, useRunningLayoutPlugins } from '@/plugins/layouts'
import { TAG_LAYOUT_VIEWS } from '../../../plugins/builtin/layouts/registry'
import { TagManageModal } from './TagManageModal'
import { TagItem } from './TagItem'
import { sortTags, useTagFiltering } from './useTagFiltering'
import { logger } from '@/lib/logger'
import { DropdownMenu } from '@/components/common/DropdownMenu'

/** 标签排序菜单的选项，顺序即菜单顺序 */
const TAG_SORT_OPTIONS: readonly TagSortPreference[] = ['usage', 'clicks', 'name']

interface TagSidebarProps {
  selectedTags: string[]
  onTagsChange: (tags: string[]) => void
  isLoadingBookmarks?: boolean
  bookmarks: Bookmark[]
  tagLayout: TagLayout
  showTagIcons?: boolean
  onTagLayoutChange: (layout: TagLayout) => void
  readOnly?: boolean
  availableTags?: Tag[]
  tagSortBy?: TagSortPreference
  onTagSortChange?: (sortBy: TagSortPreference) => void
  searchQuery?: string // 外部搜索关键词
  relatedTagIds?: string[] // 后端返回的相关标签ID
}

export function TagSidebar({
  selectedTags,
  onTagsChange,
  bookmarks,
  tagLayout,
  showTagIcons = true,
  onTagLayoutChange,
  readOnly = false,
  availableTags,
  tagSortBy: externalTagSortBy,
  onTagSortChange,
  searchQuery: externalSearchQuery = '',
  relatedTagIds: serverRelatedTagIds,
}: TagSidebarProps) {
  const { t } = useTranslation('tags')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [showManageModal, setShowManageModal] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [internalSortBy, setInternalSortBy] = useState<TagSortPreference>('usage')

  const sortBy = externalTagSortBy !== undefined ? externalTagSortBy : internalSortBy
  const setSortBy = onTagSortChange || setInternalSortBy

  const {
    data,
    isLoading,
  } = useTags({ sort: sortBy }, { enabled: !availableTags })
  const createTag = useCreateTag()
  const recordTagClick = useRecordTagClick(readOnly)

  // 公开分享页不加载账号插件目录，只提供核心布局；插件停用时回到网格但不改写已保存的选择
  const tagLayouts = availableLayouts(
    CORE_TAG_LAYOUTS,
    PLUGIN_TAG_LAYOUTS,
    'tag-',
    useRunningLayoutPlugins(!readOnly)
  )
  const activeLayout = tagLayouts.includes(tagLayout) ? tagLayout : 'grid'
  const coreLayout = activeLayout === 'masonry' ? 'masonry' : 'grid'
  const PluginTagLayoutView = (PLUGIN_TAG_LAYOUTS as readonly string[]).includes(activeLayout)
    ? TAG_LAYOUT_VIEWS[activeLayout as PluginTagLayout]
    : undefined

  const tags = useMemo(
    () => sortTags(availableTags || data?.tags || [], sortBy),
    [availableTags, data?.tags, sortBy]
  )
  const isTagLoading = availableTags ? false : isLoading
  const maxTagClickCount = useMemo(
    () => tags.reduce((maximum, tag) => Math.max(maximum, tag.click_count ?? 0), 0),
    [tags]
  )

  // 使用自定义 Hook 处理标签筛选逻辑
  const { orderedTags, relatedTagIds } = useTagFiltering(
    tags,
    bookmarks,
    selectedTags,
    externalSearchQuery,
    serverRelatedTagIds // 传递后端返回的相关标签ID
  )

  const handleToggleTag = (tagId: string) => {
    let newSelectedTags: string[]
    if (selectedTags.includes(tagId)) {
      newSelectedTags = selectedTags.filter((id) => id !== tagId)
    } else {
      newSelectedTags = [...selectedTags, tagId]
      void recordTagClick(tagId)
    }
    // 先更新选择状态，点击统计在后台写入，避免网络请求阻塞筛选反馈。
    onTagsChange(newSelectedTags)
  }

  const handleCreateTag = async (e: React.FormEvent) => {
    e.preventDefault()
    if (readOnly) return
    if (!newTagName.trim()) return

    try {
      await createTag.mutateAsync({ name: newTagName.trim() })
      setNewTagName('')
      setShowCreateForm(false)
    } catch (error) {
      logger.error('Failed to create tag:', error)
    }
  }

  const sortTitle = t('sort.names.' + sortBy)
  const layoutTitle = t('layout.names.' + activeLayout)

  return (
    <>
      <div className="tag-sidebar card flex flex-col shadow-lg h-full">
        {/* 标签头部 */}
        <div className="flex items-center gap-2 mb-4 sm:mb-6 flex-shrink-0">
          <h3 className="text-base sm:text-lg font-bold text-primary flex-shrink-0">
            {t('title')}
          </h3>

          {/* 排序菜单 */}
          <DropdownMenu
            align="left"
            trigger={
              <button
                type="button"
                className="btn btn-sm btn-ghost p-2 flex-shrink-0"
                title={sortTitle}
                aria-label={sortTitle}
                aria-haspopup="menu"
              >
                <TagSortIcon sort={sortBy} />
              </button>
            }
            items={TAG_SORT_OPTIONS.map((option) => ({
              label: t('sort.names.' + option),
              icon: <TagSortIcon sort={option} />,
              selected: option === sortBy,
              // 再次点选当前项不触发回调，免得重复保存同一个偏好
              onClick: () => {
                if (option !== sortBy) setSortBy(option)
              },
            }))}
          />

          {/* 布局菜单：只列核心布局和正在运行的布局插件 */}
          <DropdownMenu
            align="left"
            trigger={
              <button
                type="button"
                className="btn btn-sm btn-ghost p-2 flex-shrink-0"
                title={layoutTitle}
                aria-label={layoutTitle}
                aria-haspopup="menu"
              >
                <TagLayoutIcon layout={activeLayout} />
              </button>
            }
            items={tagLayouts.map((layout) => ({
              label: t('layout.names.' + layout),
              icon: <TagLayoutIcon layout={layout} />,
              selected: layout === activeLayout,
              onClick: () => {
                if (layout !== activeLayout) onTagLayoutChange(layout)
              },
            }))}
          />

          {/* 右侧按钮组 */}
          {!readOnly && (
            <>
              <button
                onClick={() => setShowManageModal(true)}
                className="btn btn-sm btn-ghost p-2 flex-shrink-0 ml-auto"
                title={t('action.manage')}
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </button>

              <button
                onClick={() => setShowCreateForm(!showCreateForm)}
                className="btn btn-sm p-2 flex-shrink-0 btn-ghost"
                title={showCreateForm ? t('action.cancel') : t('action.create')}
              >
                <svg
                  className={`w-4 h-4 transition-transform ${showCreateForm ? 'rotate-45' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </>
          )}
        </div>

        {/* 创建标签表单 */}
        {!readOnly && showCreateForm && (
          <form onSubmit={handleCreateTag} className="mb-4 sm:mb-5 animate-fade-in flex-shrink-0">
            <div className="flex gap-2">
              <input
                type="text"
                className="input flex-1 h-10 sm:h-auto text-sm sm:text-base"
                placeholder={t('form.placeholder')}
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                autoFocus
              />
              <button
                type="submit"
                className="btn btn-sm w-10 h-10 sm:w-auto sm:h-auto touch-manipulation"
                disabled={createTag.isPending}
              >
                {createTag.isPending ? '...' : '✓'}
              </button>
            </div>
          </form>
        )}

        {/* 标签列表 */}
        <div className="flex-1 overflow-y-auto scrollbar-hide p-1 min-h-0 overscroll-contain touch-auto">
          {isTagLoading && (
            <div className="text-center py-8 text-muted-foreground/60 text-sm">
              <svg className="animate-spin h-6 w-6 mx-auto mb-2" viewBox="0 0 24 24" fill="none">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              {t('status.loading')}
            </div>
          )}

          {!isTagLoading && orderedTags.length === 0 && (
            <div className="text-center py-12 text-muted-foreground/60">
              <svg
                className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                />
              </svg>
              <p className="text-sm">
                {externalSearchQuery
                  ? t('empty.noMatch')
                  : readOnly
                    ? t('empty.readOnly')
                    : t('empty.description')}
              </p>
            </div>
          )}

          {!isTagLoading && orderedTags.length > 0 && PluginTagLayoutView && (
            <PluginTagLayoutView
              tags={orderedTags}
              selectedTags={selectedTags}
              relatedTagIds={relatedTagIds}
              sortBy={sortBy}
              showIcons={showTagIcons}
              onToggle={handleToggleTag}
            />
          )}

          {!isTagLoading && orderedTags.length > 0 && !PluginTagLayoutView && (
            <div
              className={`${
                coreLayout === 'masonry'
                  ? 'flex flex-wrap items-start gap-2 justify-between'
                  : 'grid gap-2'
              }`}
              style={
                coreLayout === 'grid'
                  ? {
                      // 最多 3 列（与 VibeHub 一致），且保留窄侧栏/手机自适应：
                      // 最小列宽取 7rem 与“扣除两个 gap-2 后剩余宽度的三分之一”中的较大值，
                      // 侧栏不足约 352px 时自动降为 2 列或 1 列；外层 min(100%, ...) 防止极窄容器被撑出。
                      gridTemplateColumns:
                        'repeat(auto-fill, minmax(min(100%, max(7rem, calc((100% - 1rem) / 3))), 1fr))',
                    }
                  : undefined
              }
            >
              {orderedTags.map((tag) => (
                <TagItem
                  key={tag.id}
                  tag={tag}
                  showIcons={showTagIcons}
                  isSelected={selectedTags.includes(tag.id)}
                  isRelated={relatedTagIds.has(tag.id)}
                  hasSelection={selectedTags.length > 0}
                  layout={coreLayout}
                  heatLevel={
                    maxTagClickCount > 0
                      ? Math.log1p(tag.click_count ?? 0) / Math.log1p(maxTagClickCount)
                      : 0
                  }
                  onToggle={() => handleToggleTag(tag.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {!readOnly && showManageModal && (
        <TagManageModal tags={tags} onClose={() => setShowManageModal(false)} />
      )}
    </>
  )
}

/** 标签排序方式的图标，按钮和菜单项共用 */
function TagSortIcon({ sort }: { sort: TagSortPreference }) {
  if (sort === 'usage') {
    return (
      <svg
        className="w-4 h-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
        />
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 3h6" opacity="0.5" />
      </svg>
    )
  }
  if (sort === 'clicks') {
    return (
      <svg
        className="w-4 h-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z"
        />
      </svg>
    )
  }
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12"
      />
    </svg>
  )
}

/** 标签布局的图标，按钮和菜单项共用 */
function TagLayoutIcon({ layout }: { layout: TagLayout }) {
  if (layout === 'cloud') return <Cloud className="w-4 h-4" aria-hidden="true" />
  if (layout === 'bars') return <ChartBarDecreasing className="w-4 h-4" aria-hidden="true" />
  if (layout === 'grid') {
    return (
      <svg
        className="w-4 h-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"
        />
      </svg>
    )
  }
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7" height="8" rx="1" />
      <rect x="3" y="13" width="7" height="8" rx="1" />
      <rect x="14" y="3" width="7" height="12" rx="1" />
      <rect x="14" y="17" width="7" height="4" rx="1" />
    </svg>
  )
}
