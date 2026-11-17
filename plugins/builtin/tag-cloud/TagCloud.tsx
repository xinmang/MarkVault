import type { CSSProperties } from 'react'
import { tagScale, tagWeight } from '../layouts/grouping'
import { TagButton, type TagLayoutProps } from '../layouts/TagButton'

/** 标签云：字号随使用量变化，常用标签一眼可见。 */
export function TagCloud({ tags, sortBy, ...rest }: TagLayoutProps) {
  const max = tags.reduce((value, tag) => Math.max(value, tagWeight(tag, sortBy)), 0)
  return (
    <div className="layout-cloud">
      {tags.map((tag) => (
        <TagButton
          key={tag.id}
          tag={tag}
          className="layout-cloud__tag"
          style={{ '--tag-scale': tagScale(tagWeight(tag, sortBy), max) } as CSSProperties}
          {...rest}
        >
          <span className="layout-cloud__name">{tag.name}</span>
          {tag.bookmark_count !== undefined && <sup>{tag.bookmark_count}</sup>}
        </TagButton>
      ))}
    </div>
  )
}
