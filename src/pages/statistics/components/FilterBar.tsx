import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import type { AnalyticsFilters, Tag } from '@/lib/types'
import {
  GRANULARITIES,
  LIMIT_OPTIONS,
  RANGE_PRESETS,
  isGranularityDisabled,
  type CustomRangeError,
  type Granularity,
  type RangePreset,
  type ResultLimit,
} from '../utils/date'
import { pickRangeDescriptionKey } from '../utils/view'
import { SegmentedControl, type SegmentedOption } from './SegmentedControl'

interface FilterBarProps {
  preset: RangePreset
  customStart: string | null
  customEnd: string | null
  granularity: Granularity
  rangeStart: string | null
  rangeEnd: string
  rangeDays: number | null
  customError: CustomRangeError | null
  todayKey: string
  timeZone: string
  tags: Tag[]
  tagsAvailable: boolean
  tagId: string | null
  limit: ResultLimit
  /** 服务端回显的筛选结果，用于渲染可移除的 chip */
  appliedFilters: AnalyticsFilters | undefined
  /** 服务端解析后的区间（含“全部时间”的真实天数），优先用于描述 */
  resolvedRange: { start_date: string; end_date: string; days: number } | undefined
  onPresetChange: (preset: RangePreset) => void
  onCustomRangeChange: (start: string | null, end: string | null) => void
  onGranularityChange: (granularity: Granularity) => void
  onTagChange: (tagId: string | null) => void
  onLimitChange: (limit: ResultLimit) => void
  onClearTag: () => void
  onClearBookmark: () => void
}

/**
 * 一行筛选条：预设分段、自定义日期、粒度、标签、排行条数。
 * 下方是已生效筛选的 chip 与解析后的区间描述。
 */
export function FilterBar({
  preset,
  customStart,
  customEnd,
  granularity,
  rangeStart,
  rangeEnd,
  rangeDays,
  customError,
  todayKey,
  timeZone,
  tags,
  tagsAvailable,
  tagId,
  limit,
  appliedFilters,
  resolvedRange,
  onPresetChange,
  onCustomRangeChange,
  onGranularityChange,
  onTagChange,
  onLimitChange,
  onClearTag,
  onClearBookmark,
}: FilterBarProps) {
  const { t } = useTranslation('statistics')
  const customFieldId = useId()

  const presetOptions: SegmentedOption<RangePreset>[] = RANGE_PRESETS.map((value) => ({
    value,
    label: t(`range.${value}`),
  }))

  const granularityOptions: SegmentedOption<Granularity>[] = GRANULARITIES.map((value) => ({
    value,
    label: t(`granularity.${value}`),
    disabled: isGranularityDisabled(value, rangeDays),
    title: isGranularityDisabled(value, rangeDays) ? t('granularity.dayDisabled') : undefined,
  }))

  // 服务端返回的区间是权威值（尤其是“全部时间”才知道真实起点与天数）
  const effectiveStart = resolvedRange?.start_date ?? rangeStart ?? rangeEnd
  const effectiveEnd = resolvedRange?.end_date ?? rangeEnd
  const effectiveDays = resolvedRange?.days ?? rangeDays

  const descriptionKey = pickRangeDescriptionKey({
    days: effectiveDays,
    allTime: preset === 'all',
  })
  const description =
    descriptionKey === 'descriptionUnknown'
      ? t('range.descriptionUnknown', { tz: timeZone })
      : t(`range.${descriptionKey}`, {
          start: effectiveStart,
          end: effectiveEnd,
          days: effectiveDays ?? 0,
          tz: timeZone,
        })

  const tagChip = appliedFilters?.tag ?? null
  const bookmarkChip = appliedFilters?.bookmark ?? null
  const showChips = Boolean(tagChip || bookmarkChip)

  return (
    <section
      className="rounded-xl border border-border bg-card px-3 py-2.5"
      aria-label={t('range.label')}
    >
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          options={presetOptions}
          value={preset}
          onChange={onPresetChange}
          ariaLabel={t('range.label')}
          className="max-w-full"
        />

        {preset === 'custom' ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <label className="sr-only" htmlFor={`${customFieldId}-start`}>
              {t('range.start')}
            </label>
            <input
              id={`${customFieldId}-start`}
              type="date"
              value={customStart ?? ''}
              max={todayKey}
              aria-label={t('range.start')}
              onChange={(event) => onCustomRangeChange(event.target.value || null, customEnd)}
              className="h-8 rounded-lg border border-border bg-card px-2 text-[11.5px] text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            />
            <span className="text-[11.5px] text-muted-foreground">–</span>
            <label className="sr-only" htmlFor={`${customFieldId}-end`}>
              {t('range.end')}
            </label>
            <input
              id={`${customFieldId}-end`}
              type="date"
              value={customEnd ?? ''}
              max={todayKey}
              aria-label={t('range.end')}
              onChange={(event) => onCustomRangeChange(customStart, event.target.value || null)}
              className="h-8 rounded-lg border border-border bg-card px-2 text-[11.5px] text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            />
          </div>
        ) : null}

        <SegmentedControl
          options={granularityOptions}
          value={granularity}
          onChange={onGranularityChange}
          ariaLabel={t('granularity.label')}
        />

        {tagsAvailable ? (
          <label className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
            <span className="sr-only">{t('filter.tagLabel')}</span>
            <select
              value={tagId ?? ''}
              aria-label={t('filter.tagLabel')}
              onChange={(event) => onTagChange(event.target.value || null)}
              className="h-8 max-w-[170px] rounded-lg border border-border bg-card px-2 text-[11.5px] text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            >
              <option value="">{t('filter.allTags')}</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <span className="sr-only">{t('filter.limitLabel')}</span>
          <select
            value={String(limit)}
            aria-label={t('filter.limitLabel')}
            onChange={(event) => onLimitChange(Number(event.target.value) as ResultLimit)}
            className="h-8 rounded-lg border border-border bg-card px-2 text-[11.5px] text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          >
            {LIMIT_OPTIONS.map((option) => (
              <option key={option} value={String(option)}>
                {t('filter.limitOption', { count: option })}
              </option>
            ))}
          </select>
        </label>
      </div>

      {customError ? (
        <p role="alert" className="mt-2 text-[11px] text-destructive">
          {t(`range.error.${customError}`)}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        {showChips ? (
          <span className="flex flex-wrap items-center gap-1">
            {tagChip ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-1.5 py-0.5">
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: tagChip.color ?? 'var(--viz-series-2)' }}
                />
                <span className="max-w-[140px] truncate text-foreground">{tagChip.name}</span>
                <button
                  type="button"
                  aria-label={t('filter.removeTag', { name: tagChip.name })}
                  onClick={onClearTag}
                  className="rounded-full p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            ) : null}
            {bookmarkChip ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-1.5 py-0.5">
                <span className="text-muted-foreground">{t('filter.bookmarkChipLabel')}</span>
                <span className="max-w-[200px] truncate text-foreground" title={bookmarkChip.title}>
                  {bookmarkChip.title}
                </span>
                <button
                  type="button"
                  aria-label={t('filter.removeBookmark', { title: bookmarkChip.title })}
                  onClick={onClearBookmark}
                  className="rounded-full p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            ) : null}
            <span aria-hidden="true" className="text-border">
              ·
            </span>
          </span>
        ) : null}
        <span>{description}</span>
      </div>
    </section>
  )
}
