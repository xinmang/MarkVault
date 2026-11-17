import { useMemo, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import type { AnalyticsResponse } from '@/lib/types'
import { computeSharePercent, formatCompactNumber } from '../utils/format'
import { getHostname } from '../utils/url'
import { ratioPercent, type RankTab } from '../utils/view'
import { EmptyState } from './EmptyState'

interface RankColumnProps {
  data: AnalyticsResponse
  locale: string
  tab: RankTab
  onTabChange: (tab: RankTab) => void
  showTags: boolean
  onToggleBookmark: (bookmarkId: string) => void
  onToggleTag: (tagId: string) => void
}

interface RankRowContent {
  id: string
  name: string
  /** 行首 8px 色块的颜色 */
  swatch: string
  value: number
  /** 第三行说明 */
  meta: string
  /** 可点击时渲染为 button */
  onClick?: () => void
  active: boolean
  title?: string
}

/**
 * 排行列：书签 / 标签 / 域名三个页签，行内包含色块、名称、数值、
 * 比例条与一行补充说明。域名行不可点击。
 */
export function RankColumn({
  data,
  locale,
  tab,
  onTabChange,
  showTags,
  onToggleBookmark,
  onToggleTag,
}: RankColumnProps) {
  const { t } = useTranslation('statistics')

  // 页签用短标签（书签 / 标签 / 域名），卡片标题另由 tablist 的 aria-label 说明
  const tabs = useMemo(() => {
    const list: Array<{ value: RankTab; label: string }> = [
      { value: 'bookmarks', label: t('rank.tabBookmarks') },
    ]
    if (showTags) list.push({ value: 'tags', label: t('rank.tabTags') })
    list.push({ value: 'domains', label: t('rank.tabDomains') })
    return list
  }, [showTags, t])

  // 标签页签被隐藏时，即便当前状态是 tags 也回落到书签
  const effectiveTab: RankTab = tab === 'tags' && !showTags ? 'bookmarks' : tab

  const activeBookmarkId = data.filters.bookmark?.id ?? null
  const activeTagId = data.filters.tag?.id ?? null

  const rows = useMemo<RankRowContent[]>(() => {
    if (effectiveTab === 'bookmarks') {
      return data.top_bookmarks.map((item) => ({
        id: item.id,
        name: item.title,
        swatch: 'var(--viz-series-1)',
        value: item.clicks,
        meta: [
          getHostname(item.url),
          t('rank.share', {
            percent: computeSharePercent(item.clicks, data.summary.bookmark_clicks) ?? 0,
          }),
        ]
          .filter(Boolean)
          .join(' · '),
        onClick: () => onToggleBookmark(item.id),
        active: item.id === activeBookmarkId,
        title: item.title,
      }))
    }
    if (effectiveTab === 'tags') {
      return data.top_tags.map((item) => ({
        id: item.id,
        name: item.name,
        swatch: item.color ?? 'var(--viz-series-2)',
        value: item.clicks,
        meta: [
          t('rank.linkedBookmarks', { count: item.bookmark_count }),
          t('rank.share', {
            percent: computeSharePercent(item.clicks, data.summary.tag_clicks) ?? 0,
          }),
        ].join(' · '),
        onClick: () => onToggleTag(item.id),
        active: item.id === activeTagId,
        title: item.name,
      }))
    }
    return data.top_domains.map((item) => ({
      id: item.domain,
      name: item.domain,
      swatch: 'var(--viz-series-1)',
      value: item.clicks,
      meta: t('rank.bookmarkCount', { count: item.bookmarks }),
      active: false,
      title: item.domain,
    }))
  }, [activeBookmarkId, activeTagId, data, effectiveTab, onToggleBookmark, onToggleTag, t])

  const maxValue = rows.reduce((max, row) => (row.value > max ? row.value : max), 0)

  return (
    <div className="min-w-0">
      {/* 这是互斥的分段选择，不是真正的 tab 面板，所以用 aria-pressed 而非 tablist */}
      <div className="mb-1.5 flex items-center gap-1" role="group" aria-label={t('rank.tabsLabel')}>
        {tabs.map((item) => {
          const selected = item.value === effectiveTab
          return (
            <button
              key={item.value}
              type="button"
              aria-pressed={selected}
              onClick={() => onTabChange(item.value)}
              className={`rounded-md px-2 py-1 text-[11.5px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring ${
                selected
                  ? 'bg-muted font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {item.label}
            </button>
          )
        })}
      </div>

      {rows.length === 0 ? (
        <EmptyState message={t('rank.empty')} />
      ) : (
        <div className="flex flex-col gap-0.5">
          {rows.map((row, index) => {
            const widthPercent = ratioPercent(row.value, maxValue)
            const content = (
              <>
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 shrink-0 rounded-[2px]"
                    style={{ backgroundColor: row.swatch }}
                  />
                  <span
                    className="truncate text-[12px] font-medium text-foreground"
                    title={row.title ?? row.name}
                  >
                    {row.name}
                  </span>
                  <span className="ml-auto shrink-0 pl-2 text-[12px] font-semibold tabular-nums text-foreground">
                    {formatCompactNumber(row.value, locale)}
                  </span>
                </span>

                <span
                  aria-hidden="true"
                  className="mt-1 ml-[15px] block h-1 overflow-hidden rounded bg-muted"
                >
                  <span
                    className="viz-rank-fill block h-full rounded"
                    style={
                      {
                        width: `${widthPercent}%`,
                        backgroundColor: row.swatch,
                        opacity: 0.7,
                        '--viz-index': index,
                      } as CSSProperties
                    }
                  />
                </span>

                <span className="mt-0.5 ml-[15px] block truncate text-[10.5px] text-muted-foreground">
                  {row.meta}
                </span>
              </>
            )

            const shared = `viz-rank-row flex w-full flex-col rounded-lg px-2 pt-1.5 pb-[7px] text-left ${
              row.active ? 'bg-primary/10' : ''
            }`

            if (!row.onClick) {
              return (
                <div key={row.id} className={shared}>
                  {content}
                </div>
              )
            }

            return (
              <button
                key={row.id}
                type="button"
                onClick={row.onClick}
                aria-pressed={row.active}
                title={row.title ?? row.name}
                className={`${shared} cursor-pointer hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring`}
              >
                {content}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
