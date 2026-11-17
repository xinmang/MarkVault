import type { Bookmark, Tag } from '@/lib/types'

/**
 * 起始页的快捷访问：置顶书签在前（保持传入顺序），其后是访问次数最多的书签。
 * 从未访问过的非置顶书签不占位，没有可推荐的内容时返回空数组。
 */
export function quickAccessBookmarks(bookmarks: readonly Bookmark[], limit = 12): Bookmark[] {
  const pinned = bookmarks.filter((bookmark) => bookmark.is_pinned)
  const visited = bookmarks
    .filter((bookmark) => !bookmark.is_pinned && (bookmark.click_count ?? 0) > 0)
    .sort((left, right) => (right.click_count ?? 0) - (left.click_count ?? 0))
  return [...pinned, ...visited].slice(0, limit)
}

export interface TagColumn {
  /** 未加标签的书签归到 tag 为 undefined 的一列 */
  tag?: Tag
  items: Bookmark[]
}

/**
 * 标签看板的分列：按传入的标签顺序，每个出现在书签里的标签一列，列内保持书签顺序；
 * 一条书签带几个标签就出现在几列。超过 limit 的标签不成列，没有标签的书签单独放在最后一列。
 */
export function tagColumns(
  bookmarks: readonly Bookmark[],
  tags: readonly Tag[],
  limit = 24
): TagColumn[] {
  const byTag = new Map<string, Bookmark[]>()
  const untagged: Bookmark[] = []
  for (const bookmark of bookmarks) {
    if (!bookmark.tags?.length) {
      untagged.push(bookmark)
      continue
    }
    for (const tag of bookmark.tags) {
      const items = byTag.get(tag.id)
      if (items) items.push(bookmark)
      else byTag.set(tag.id, [bookmark])
    }
  }
  const columns: TagColumn[] = []
  for (const tag of tags) {
    const items = byTag.get(tag.id)
    if (!items) continue
    columns.push({ tag, items })
    if (columns.length >= limit) break
  }
  if (untagged.length > 0) columns.push({ items: untagged })
  return columns
}

export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night'

/** 起始页问候语使用的时段。 */
export function dayPart(now = new Date()): DayPart {
  const hour = now.getHours()
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 18) return 'afternoon'
  if (hour >= 18 && hour < 23) return 'evening'
  return 'night'
}

interface StripGroup {
  id: string
  parent_id: string | null
  is_folder: number
  position: number
  item_count?: number
  items?: unknown[]
}

export interface TabStripEntry<Group> {
  group: Group
  /** 0 为顶层，文件夹里的分组为 1，更深的层级依次递增 */
  depth: number
  /** 分组里的标签页数量；文件夹为其下全部分组之和 */
  count: number
}

/**
 * 顶部分组栏的顺序：与分组树一致，按 position 排列，文件夹后面紧跟它里面的分组。
 * 父分组已不存在的分组当作顶层处理。
 */
export function tabStripEntries<Group extends StripGroup>(
  groups: readonly Group[]
): TabStripEntry<Group>[] {
  const ids = new Set(groups.map((group) => group.id))
  const children = new Map<string | null, Group[]>()
  for (const group of groups) {
    const parent = group.parent_id && ids.has(group.parent_id) ? group.parent_id : null
    const siblings = children.get(parent)
    if (siblings) siblings.push(group)
    else children.set(parent, [group])
  }
  const entries: TabStripEntry<Group>[] = []
  const visit = (parent: string | null, depth: number): number => {
    let total = 0
    const siblings = [...(children.get(parent) ?? [])].sort(
      (left, right) => (left.position || 0) - (right.position || 0)
    )
    for (const group of siblings) {
      const entry: TabStripEntry<Group> = { group, depth, count: 0 }
      entries.push(entry)
      const own = group.is_folder === 1 ? 0 : (group.item_count ?? group.items?.length ?? 0)
      entry.count = own + visit(group.id, depth + 1)
      total += entry.count
    }
    return total
  }
  visit(null, 0)
  return entries
}

/**
 * 卡片墙的分列：按顺序把每个分组放进当前最短的一列，列高按标签页数量估算。
 * 结果仍然大致保持从左到右、从上到下的阅读顺序。
 */
export function wallColumns<Group extends { items?: unknown[] }>(
  groups: readonly Group[],
  columnCount: number
): Group[][] {
  const columns: Group[][] = Array.from({ length: Math.max(1, columnCount) }, () => [])
  const heights = columns.map(() => 0)
  for (const group of groups) {
    const shortest = heights.indexOf(Math.min(...heights))
    columns[shortest]!.push(group)
    // 标题栏约等于一个半标签页的高度，空分组还有一行提示
    heights[shortest]! += 1.5 + Math.max(1, group.items?.length ?? 0)
  }
  return columns
}
