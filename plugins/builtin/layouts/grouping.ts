import type { Bookmark, Tag, TagSortPreference } from '@/lib/types'

export function bookmarkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url.replace(/^https?:\/\//i, '').split('/')[0] || url
  }
}

export type TimelinePeriod = 'today' | 'yesterday' | 'week' | 'month' | 'unknown'

export interface TimelineGroup<Item = Bookmark> {
  key: string
  period: TimelinePeriod
  /** 时间段起点的本地时间戳；month 为当月 1 日，unknown 为负无穷 */
  start: number
  items: Item[]
}

/**
 * 按创建时间归入“今天、昨天、近 7 天、更早的各个月份”，时间段从近到远排列。
 * 段内保持传入顺序，因此按热度或置顶排序时仍然遵循用户选择的排序。
 * 书签时间线和标签页组的收纳时间线共用。
 */
export function timelineGroups<Item extends { created_at: string }>(
  bookmarks: readonly Item[],
  now = new Date()
): TimelineGroup<Item>[] {
  const dayStart = (offset: number) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset).getTime()
  const today = dayStart(0)
  const yesterday = dayStart(1)
  const week = dayStart(6)
  const groups = new Map<string, TimelineGroup<Item>>()
  for (const bookmark of bookmarks) {
    const time = new Date(bookmark.created_at).getTime()
    let period: TimelinePeriod
    let start: number
    if (!Number.isFinite(time)) {
      period = 'unknown'
      start = Number.NEGATIVE_INFINITY
    } else if (time >= today) {
      period = 'today'
      start = today
    } else if (time >= yesterday) {
      period = 'yesterday'
      start = yesterday
    } else if (time >= week) {
      period = 'week'
      start = week
    } else {
      const date = new Date(time)
      period = 'month'
      start = new Date(date.getFullYear(), date.getMonth(), 1).getTime()
    }
    const key = period === 'month' ? 'month:' + start : period
    const group = groups.get(key)
    if (group) group.items.push(bookmark)
    else groups.set(key, { key, period, start, items: [bookmark] })
  }
  return [...groups.values()].sort((left, right) => (left.start < right.start ? 1 : -1))
}

export interface DomainGroup {
  /** 站点主机名；空字符串表示“只收藏了一条的站点”合并成的分组 */
  host: string
  items: Bookmark[]
}

/** 同一站点的书签归为一组，书签多的站点在前；只有一条书签的站点合并到末尾一组。 */
export function domainGroups(bookmarks: Bookmark[]): DomainGroup[] {
  const byHost = new Map<string, Bookmark[]>()
  for (const bookmark of bookmarks) {
    const host = bookmarkHost(bookmark.url)
    const items = byHost.get(host)
    if (items) items.push(bookmark)
    else byHost.set(host, [bookmark])
  }
  const groups: DomainGroup[] = []
  const rest: Bookmark[] = []
  for (const [host, items] of byHost) {
    if (items.length > 1) groups.push({ host, items })
    else rest.push(...items)
  }
  groups.sort((left, right) => right.items.length - left.items.length)
  if (rest.length > 0) groups.push({ host: '', items: rest })
  return groups
}

/** 标签的权重跟随侧栏排序方式：按点击排序时取点击次数，否则取书签数量。 */
export function tagWeight(tag: Tag, sortBy: TagSortPreference): number {
  return Math.max(0, (sortBy === 'clicks' ? tag.click_count : tag.bookmark_count) ?? 0)
}

/** 对数缩放到 0–1，避免个别高频标签把其余标签压得无法区分。 */
export function tagScale(weight: number, max: number): number {
  return max > 0 ? Math.log1p(Math.max(0, weight)) / Math.log1p(max) : 0
}
