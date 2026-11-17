/**
 * 标签筛选逻辑 Hook
 */
import { useMemo } from 'react'
import type { Bookmark, Tag, TagSortPreference } from '@/lib/types'

/** 按标签栏的排序方式排列：使用量、点击次数或名称，数量相同时按名称。 */
export function sortTags(tags: readonly Tag[], sortBy: TagSortPreference): Tag[] {
  return [...tags].sort((left, right) => {
    if (sortBy === 'name') return left.name.localeCompare(right.name)
    if (sortBy === 'clicks') {
      return (
        (right.click_count ?? 0) - (left.click_count ?? 0) || left.name.localeCompare(right.name)
      )
    }
    return (
      (right.bookmark_count ?? 0) - (left.bookmark_count ?? 0) ||
      left.name.localeCompare(right.name)
    )
  })
}

export function useTagFiltering(
  tags: Tag[],
  bookmarks: Bookmark[],
  selectedTags: string[],
  searchQuery: string,
  serverRelatedTagIds?: string[] // 后端返回的相关标签ID（基于所有书签）
) {
  // 计算相关标签
  const relatedTagIds = useMemo(() => {
    if (selectedTags.length === 0) return new Set<string>()
    const selected = new Set(selectedTags)

    // 空数组也是有效结果，不能用旧页面的书签重新推算候选。
    if (serverRelatedTagIds !== undefined) {
      return new Set(serverRelatedTagIds.filter((id) => !selected.has(id)))
    }

    // 公开分享页及旧接口降级：候选必须来自同时包含全部已选标签的同一条书签。
    const related = new Set<string>()
    for (const bookmark of bookmarks) {
      const ids = new Set(bookmark.tags?.map((tag) => tag.id))
      if (!selectedTags.every((id) => ids.has(id))) continue
      for (const id of ids) {
        if (id && !selected.has(id)) related.add(id)
      }
    }
    return related
  }, [selectedTags, bookmarks, serverRelatedTagIds])

  // 搜索筛选
  const filteredTags = useMemo(() => {
    if (!searchQuery.trim()) return tags

    const query = searchQuery.toLowerCase()
    return tags.filter((tag) => tag.name.toLowerCase().includes(query))
  }, [tags, searchQuery])

  // 排序：已选中、相关、其他
  const orderedTags = useMemo(() => {
    const selected: Tag[] = []
    const related: Tag[] = []
    const others: Tag[] = []

    for (const tag of filteredTags) {
      if (selectedTags.includes(tag.id)) {
        selected.push(tag)
      } else if (relatedTagIds.has(tag.id)) {
        related.push(tag)
      } else {
        others.push(tag)
      }
    }

    return [...selected, ...related, ...others]
  }, [filteredTags, selectedTags, relatedTagIds])

  return { orderedTags, relatedTagIds }
}
