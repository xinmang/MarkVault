/**
 * 标签项组件 - 单个标签的展示
 */
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { resolveTagIcon } from '@/lib/tag-icons'
import { TagIcon } from './TagIcon'
import type { Tag } from '@/lib/types'
import { useExperimentalFeatures } from '@/contexts/ExperimentalFeaturesContext'
import { getTagHeatRarity, resolveTagHeatEffect } from './tagHeatEffects'

type TagHeatCssProperties = CSSProperties & {
  '--tag-heat-color': string
  '--tag-heat-strength': number
}

interface TagItemProps {
  tag: Tag
  isSelected: boolean
  isRelated: boolean
  hasSelection: boolean
  layout: 'grid' | 'masonry'
  heatLevel?: number
  showIcons?: boolean
  onToggle: () => void
}

export function TagItem({
  tag,
  isSelected,
  isRelated,
  hasSelection,
  layout,
  heatLevel = 0,
  showIcons = true,
  onToggle,
}: TagItemProps) {
  const { tagHeat } = useExperimentalFeatures()
  const { t } = useTranslation('tags')
  const hasIcon = showIcons && !!resolveTagIcon(tag.name, tag.icon)
  const stateClasses = isSelected
    ? 'border border-transparent bg-primary text-primary-content shadow-inner ring-1 ring-primary/40'
    : isRelated
      ? 'border border-transparent bg-accent/5 text-accent'
      : hasSelection
        ? 'border border-transparent bg-base-200/80 text-muted-foreground opacity-70 ring-1 ring-transparent'
        : 'border border-border bg-card hover:border-primary/50 ring-1 ring-transparent'

  const indicatorClasses = isSelected
    ? 'bg-primary-content/20 border-2 border-primary-content'
    : isRelated
      ? 'bg-accent/20 border-2 border-accent'
      : 'bg-transparent border-2 border-border'

  const countClasses = isSelected
    ? 'bg-primary-content/25 text-primary-content'
    : isRelated
      ? 'bg-accent/20 text-accent'
      : hasSelection
        ? 'bg-base-300 text-muted-foreground'
        : 'bg-muted text-muted-foreground'

  const layoutClasses =
    layout === 'masonry'
      ? 'inline-flex items-center gap-2 px-3 py-2 rounded-lg'
      : 'flex w-full items-center justify-between px-2.5 py-2'

  const showMarquee = isSelected || isRelated
  const marqueeStroke = isSelected ? 'var(--accent)' : 'var(--primary)'
  const marqueeOpacity = isSelected ? 0.9 : 0.65
  const marqueeDuration = isSelected ? '1s' : '3s'
  // 虚线条比边框多出一个周期（12px），用 transform 平移，避免每帧重绘背景
  const marqueeStrip = (direction: 'right' | 'down' | 'left' | 'up'): CSSProperties => ({
    background: `repeating-linear-gradient(${direction === 'right' || direction === 'left' ? '90deg' : '180deg'}, ${marqueeStroke} 0px, ${marqueeStroke} 8px, transparent 8px, transparent 12px)`,
    opacity: marqueeOpacity,
    animation: `tag-marquee-move-${direction} ${marqueeDuration} linear infinite`,
  })
  const normalizedHeat = Math.min(1, Math.max(0, heatLevel))
  const heatOpacity = (0.12 + normalizedHeat * 0.58) * (tagHeat.intensity / 100)
  const showHeat = tagHeat.enabled && !isSelected && normalizedHeat > 0
  const heatRarity = getTagHeatRarity(normalizedHeat)
  const resolvedHeatEffect = resolveTagHeatEffect(tagHeat.effect, heatRarity)

  const heatOverlay =
    showHeat && tagHeat.style === 'fill' ? (
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{ backgroundColor: tagHeat.color, opacity: heatOpacity }}
      />
    ) : showHeat && tagHeat.style === 'progress' ? (
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-1.5 bg-muted/30">
        <div
          className="h-full transition-[width] duration-300"
          style={{
            width: `${Math.max(4, normalizedHeat * 100)}%`,
            backgroundColor: tagHeat.color,
            opacity: Math.min(0.95, heatOpacity + 0.2),
          }}
        />
      </div>
    ) : showHeat && tagHeat.style === 'liquid' ? (
      <div
        className="tag-liquid-fill pointer-events-none absolute inset-x-0 bottom-0 z-0 transition-[height] duration-500"
        style={{
          height: `${Math.max(8, normalizedHeat * 100)}%`,
          backgroundColor: tagHeat.color,
          opacity: Math.min(0.85, heatOpacity + 0.12),
        }}
      />
    ) : showHeat ? (
      <div
        className={`tag-heat-card tag-heat-card--${heatRarity} tag-heat-card--effect-${resolvedHeatEffect} pointer-events-none absolute inset-0 z-0`}
        style={
          {
            '--tag-heat-color': tagHeat.color,
            '--tag-heat-strength': Math.max(0.2, normalizedHeat * (tagHeat.intensity / 100)),
          } as TagHeatCssProperties
        }
      >
        <div className="tag-heat-card__effect" />
        <div className="tag-heat-card__sparkles" />
      </div>
    ) : null

  return (
    <button
      type="button"
      aria-pressed={isSelected}
      data-link-tag={tag.id}
      className={`tag-item relative min-h-11 overflow-hidden rounded-lg text-left cursor-pointer transition-all focus-visible:outline-2 focus-visible:outline-primary ${layout === 'grid' ? 'w-full' : ''} ${stateClasses}`}
      onClick={onToggle}
      title={t('clickCount', { name: tag.name, count: tag.click_count ?? 0 })}
    >
      {heatOverlay}
      {showMarquee && (
        <div className="pointer-events-none absolute inset-0 z-0 rounded-lg overflow-hidden">
          <div className="tag-marquee-strip absolute top-0 -left-3 right-0 h-0.5" style={marqueeStrip('right')} />
          <div className="tag-marquee-strip absolute -top-3 right-0 bottom-0 w-0.5" style={marqueeStrip('down')} />
          <div className="tag-marquee-strip absolute bottom-0 left-0 -right-3 h-0.5" style={marqueeStrip('left')} />
          <div className="tag-marquee-strip absolute top-0 left-0 -bottom-3 w-0.5" style={marqueeStrip('up')} />
        </div>
      )}
      <div className={`relative z-10 ${layoutClasses}`}>
        <div className={`flex items-center gap-2 ${layout === 'masonry' ? '' : 'flex-1 min-w-0'}`}>
          {hasIcon ? (
            <span
              className="relative flex h-4 w-4 shrink-0 items-center justify-center"
              aria-hidden="true"
            >
              <TagIcon name={tag.name} icon={tag.icon} />
              {isSelected && (
                <span className="absolute -bottom-1 -right-1 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-primary-content text-primary">
                  <svg
                    className="h-2 w-2"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="4"
                  >
                    <path d="m5 12 4 4L19 6" />
                  </svg>
                </span>
              )}
            </span>
          ) : (
            <span
              className={`w-3.5 h-3.5 rounded flex-shrink-0 flex items-center justify-center ${indicatorClasses}`}
            >
              {isSelected && (
                <svg
                  className="w-2 h-2 text-primary-content"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={3.5}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              )}
            </span>
          )}

          <span
            className={`text-xs ${layout === 'masonry' ? 'whitespace-nowrap' : 'truncate flex-1'} ${isSelected ? 'font-semibold' : 'font-medium'}`}
          >
            {tag.name}
          </span>

          {tag.bookmark_count !== undefined && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${countClasses}`}>
              {tag.bookmark_count}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}
