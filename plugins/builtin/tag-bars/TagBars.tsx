import { tagWeight } from '../layouts/grouping'
import { TagButton, type TagLayoutProps } from '../layouts/TagButton'

/** 标签排行：每行一个标签，横条长度表示书签数量（按点击排序时表示点击次数）。 */
export function TagBars({ tags, sortBy, ...rest }: TagLayoutProps) {
  const max = tags.reduce((value, tag) => Math.max(value, tagWeight(tag, sortBy)), 0)
  return (
    <div className="layout-bars">
      {tags.map((tag) => {
        const weight = tagWeight(tag, sortBy)
        return (
          <TagButton key={tag.id} tag={tag} className="layout-bars__row" {...rest}>
            <span
              className="layout-bars__fill"
              style={{ width: max > 0 ? `${(weight / max) * 100}%` : 0 }}
              aria-hidden="true"
            />
            <span className="layout-bars__name">{tag.name}</span>
            <span className="layout-bars__count">{weight}</span>
          </TagButton>
        )
      })}
    </div>
  )
}
