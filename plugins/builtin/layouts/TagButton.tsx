import type { CSSProperties, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Tag, TagSortPreference } from '@/lib/types'
import { resolveTagIcon } from '@/lib/tag-icons'
import { TagIcon } from '@/components/tags/TagIcon'
import './style.css'

/** 布局插件提供的标签列表与侧栏核心布局使用同一份已排序、已筛选的数据。 */
export interface TagLayoutProps {
  /** 已按“已选、待选、其他”排好的标签 */
  tags: Tag[]
  selectedTags: string[]
  relatedTagIds: ReadonlySet<string>
  sortBy: TagSortPreference
  showIcons: boolean
  onToggle: (tagId: string) => void
}

type TagButtonProps = Pick<TagLayoutProps, 'selectedTags' | 'relatedTagIds' | 'showIcons' | 'onToggle'> & {
  tag: Tag
  className: string
  style?: CSSProperties
  children: ReactNode
}

/** 保留 tag-item 类名与 data-link-tag，标签与书签联动、选中动效对插件布局同样生效。 */
export function TagButton({
  tag,
  selectedTags,
  relatedTagIds,
  showIcons,
  onToggle,
  className,
  style,
  children,
}: TagButtonProps) {
  const { t } = useTranslation('tags')
  const selected = selectedTags.includes(tag.id)
  const state = selected
    ? 'selected'
    : relatedTagIds.has(tag.id)
      ? 'related'
      : selectedTags.length > 0
        ? 'dimmed'
        : undefined
  return (
    <button
      type="button"
      aria-pressed={selected}
      data-link-tag={tag.id}
      data-state={state}
      className={`tag-item ${className}`}
      style={style}
      onClick={() => onToggle(tag.id)}
      title={t('clickCount', { name: tag.name, count: tag.click_count ?? 0 })}
    >
      {showIcons && !!resolveTagIcon(tag.name, tag.icon) && (
        <span className="layout-tag-icon" aria-hidden="true">
          <TagIcon name={tag.name} icon={tag.icon} className="h-full w-full" />
        </span>
      )}
      {children}
    </button>
  )
}
