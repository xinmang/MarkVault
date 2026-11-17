import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import {
  Archive,
  CalendarDays,
  Camera,
  Eye,
  Globe2,
  Pin,
  Sparkles,
  Tags,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  Bookmark,
  ExperimentalHoverCardEffect,
  ExperimentalHoverCardTheme,
  ExperimentalUrlPrivacyEffect,
} from '@/lib/types'
import { getFaviconUrl } from '@/components/bookmarks/bookmark-utils'

export type HoverCardRarity = 'base' | 'advanced' | 'collector' | 'secret'

export interface HoverCardSettings {
  enabled: boolean
  theme: ExperimentalHoverCardTheme
  effect: ExperimentalHoverCardEffect
  accentColor: string
  intensity: number
  size: number
  delay: number
  advancedClicks: number
  collectorClicks: number
  secretClicks: number
}

export interface UrlPrivacySettings {
  enabled: boolean
  effect: ExperimentalUrlPrivacyEffect
  strength: number
}

interface AnchorRect {
  top: number
  left: number
  right: number
  bottom: number
  width: number
  height: number
}

interface PreviewState {
  bookmark: Bookmark
  anchor: AnchorRect
  pointerX: number
  pointerY: number
}

interface BookmarkHoverCardContextValue {
  show: (bookmark: Bookmark, element: HTMLElement) => void
  move: (bookmarkId: string, element: HTMLElement, clientX: number, clientY: number) => void
  hide: (bookmarkId: string) => void
}

const EMPTY_CONTEXT: BookmarkHoverCardContextValue = {
  show: () => undefined,
  move: () => undefined,
  hide: () => undefined,
}

const BookmarkHoverCardContext = createContext<BookmarkHoverCardContextValue>(EMPTY_CONTEXT)

// eslint-disable-next-line react-refresh/only-export-components
export function getHoverCardRarity(
  clickCount: number,
  settings: Pick<HoverCardSettings, 'advancedClicks' | 'collectorClicks' | 'secretClicks'>,
): HoverCardRarity {
  if (clickCount >= settings.secretClicks) return 'secret'
  if (clickCount >= settings.collectorClicks) return 'collector'
  if (clickCount >= settings.advancedClicks) return 'advanced'
  return 'base'
}

// eslint-disable-next-line react-refresh/only-export-components
export function resolveHoverCardEffect(
  effect: ExperimentalHoverCardEffect,
  rarity: HoverCardRarity,
): Exclude<ExperimentalHoverCardEffect, 'auto'> {
  if (effect !== 'auto') return effect
  if (rarity === 'secret') return 'galaxy'
  if (rarity === 'collector') return 'prism'
  if (rarity === 'advanced') return 'foil'
  return 'none'
}

function toAnchorRect(rect: DOMRect): AnchorRect {
  return {
    top: rect.top,
    left: rect.left,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  }
}

export function BookmarkHoverCardProvider({
  settings,
  urlPrivacy,
  children,
}: {
  settings: HoverCardSettings
  urlPrivacy: UrlPrivacySettings
  children: ReactNode
}) {
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeBookmarkIdRef = useRef<string | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const hideAll = useCallback(() => {
    clearTimer()
    activeBookmarkIdRef.current = null
    setPreview(null)
  }, [clearTimer])

  useEffect(() => {
    if (!settings.enabled) hideAll()
  }, [hideAll, settings.enabled])

  useEffect(() => {
    window.addEventListener('resize', hideAll)
    window.addEventListener('scroll', hideAll, true)
    return () => {
      window.removeEventListener('resize', hideAll)
      window.removeEventListener('scroll', hideAll, true)
    }
  }, [hideAll])

  useEffect(() => () => clearTimer(), [clearTimer])

  const show = useCallback((bookmark: Bookmark, element: HTMLElement) => {
    if (!settings.enabled) return
    if (window.matchMedia('(hover: none)').matches) return

    clearTimer()
    const anchor = toAnchorRect(element.getBoundingClientRect())
    timerRef.current = setTimeout(() => {
      activeBookmarkIdRef.current = bookmark.id
      setPreview({ bookmark, anchor, pointerX: 0.5, pointerY: 0.5 })
      timerRef.current = null
    }, settings.delay)
  }, [clearTimer, settings.delay, settings.enabled])

  const move = useCallback((bookmarkId: string, element: HTMLElement, clientX: number, clientY: number) => {
    if (activeBookmarkIdRef.current !== bookmarkId) return
    const rect = element.getBoundingClientRect()
    const pointerX = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)))
    const pointerY = Math.min(1, Math.max(0, (clientY - rect.top) / Math.max(1, rect.height)))
    setPreview((current) => current?.bookmark.id === bookmarkId
      ? { ...current, anchor: toAnchorRect(rect), pointerX, pointerY }
      : current)
  }, [])

  const hide = useCallback((bookmarkId: string) => {
    clearTimer()
    if (activeBookmarkIdRef.current === bookmarkId) {
      activeBookmarkIdRef.current = null
      setPreview(null)
    }
  }, [clearTimer])

  const contextValue = useMemo<BookmarkHoverCardContextValue>(
    () => ({ show, move, hide }),
    [hide, move, show],
  )

  return (
    <BookmarkHoverCardContext.Provider value={contextValue}>
      {children}
      {preview && typeof document !== 'undefined'
        ? createPortal(
            <BookmarkHoverCardPreview
              preview={preview}
              settings={settings}
              urlPrivacy={urlPrivacy}
            />,
            document.body,
          )
        : null}
    </BookmarkHoverCardContext.Provider>
  )
}

/** 为任意书签条目根节点提供一致的悬停和键盘聚焦预览行为。 */
// eslint-disable-next-line react-refresh/only-export-components
export function useBookmarkHoverCard(bookmark: Bookmark) {
  const controller = useContext(BookmarkHoverCardContext)

  return useMemo(() => ({
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === 'mouse') controller.show(bookmark, event.currentTarget)
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === 'mouse') {
        controller.move(bookmark.id, event.currentTarget, event.clientX, event.clientY)
      }
    },
    onPointerLeave: () => controller.hide(bookmark.id),
    onFocusCapture: (event: FocusEvent<HTMLElement>) => controller.show(bookmark, event.currentTarget),
    onBlurCapture: (event: FocusEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        controller.hide(bookmark.id)
      }
    },
  }), [bookmark, controller])
}

type TradingCardStyle = CSSProperties & {
  '--tcg-accent': string
  '--tcg-intensity': number
  '--tcg-pointer-x': string
  '--tcg-pointer-y': string
  '--tcg-rotate-x': string
  '--tcg-rotate-y': string
}

const HOVER_CARD_WIDTH = 356
const HOVER_CARD_HEIGHT = 590

function getCardPosition(anchor: AnchorRect, size: number) {
  const gap = 18
  const margin = 12
  const requestedScale = Math.min(1.25, Math.max(0.75, size / 100))
  const availableWidth = Math.max(1, window.innerWidth - margin * 2)
  const availableHeight = Math.max(1, window.innerHeight - margin * 2)
  const scale = Math.min(
    requestedScale,
    availableWidth / HOVER_CARD_WIDTH,
    availableHeight / HOVER_CARD_HEIGHT,
  )
  const cardWidth = HOVER_CARD_WIDTH * scale
  const cardHeight = HOVER_CARD_HEIGHT * scale
  const rightPosition = anchor.right + gap
  const leftPosition = anchor.left - cardWidth - gap
  const left = rightPosition + cardWidth <= window.innerWidth - margin
    ? rightPosition
    : leftPosition >= margin
      ? leftPosition
      : Math.max(margin, (window.innerWidth - cardWidth) / 2)
  const top = Math.min(
    Math.max(margin, anchor.top - 8),
    Math.max(margin, window.innerHeight - cardHeight - margin),
  )
  return { left, top, cardWidth, cardHeight, scale }
}

function formatCardDate(value: string | null | undefined, locale: string, fallback: string) {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(date)
}

function CardUrl({ value, privacy }: { value: string; privacy: UrlPrivacySettings }) {
  if (!privacy.enabled) return <>{value}</>
  if (privacy.effect === 'mask') return <span className="url-privacy-mask">{'█'.repeat(18)}</span>

  const strength = Math.min(12, Math.max(1, privacy.strength))
  const style = privacy.effect === 'blur'
    ? { '--url-privacy-blur': `${1 + strength * 0.55}px` }
    : { '--url-privacy-block-size': `${3 + strength}px` }

  return (
    <span
      className={privacy.effect === 'blur' ? 'url-privacy-blur' : 'url-privacy-mosaic'}
      style={style as CSSProperties}
    >
      {value}
    </span>
  )
}

function BookmarkHoverCardPreview({
  preview,
  settings,
  urlPrivacy,
}: {
  preview: PreviewState
  settings: HoverCardSettings
  urlPrivacy: UrlPrivacySettings
}) {
  const position = getCardPosition(preview.anchor, settings.size)

  return (
    <div
      className="bookmark-tcg-preview"
      style={{
        left: position.left,
        top: position.top,
        width: position.cardWidth,
        height: position.cardHeight,
      }}
      aria-hidden="true"
    >
      <div
        className="bookmark-tcg-preview__scale"
        style={{
          width: HOVER_CARD_WIDTH,
          maxHeight: HOVER_CARD_HEIGHT,
          transform: `scale(${position.scale})`,
        }}
      >
        <BookmarkTradingCard
          bookmark={preview.bookmark}
          settings={settings}
          urlPrivacy={urlPrivacy}
          pointerX={preview.pointerX}
          pointerY={preview.pointerY}
        />
      </div>
    </div>
  )
}

export function BookmarkTradingCard({
  bookmark,
  settings,
  urlPrivacy,
  pointerX = 0.5,
  pointerY = 0.5,
  className = '',
}: {
  bookmark: Bookmark
  settings: HoverCardSettings
  urlPrivacy: UrlPrivacySettings
  pointerX?: number
  pointerY?: number
  className?: string
}) {
  const { t, i18n } = useTranslation('settings')
  const rarity = getHoverCardRarity(bookmark.click_count ?? 0, settings)
  const effect = resolveHoverCardEffect(settings.effect, rarity)
  const reduceMotion = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const tiltStrength = effect === 'none' || reduceMotion ? 0 : 2 + (settings.intensity / 100) * 5
  const style: TradingCardStyle = {
    '--tcg-accent': settings.accentColor,
    '--tcg-intensity': settings.intensity / 100,
    '--tcg-pointer-x': `${pointerX * 100}%`,
    '--tcg-pointer-y': `${pointerY * 100}%`,
    '--tcg-rotate-x': `${(0.5 - pointerY) * tiltStrength}deg`,
    '--tcg-rotate-y': `${(pointerX - 0.5) * tiltStrength}deg`,
  }
  const screenshotUrl = bookmark.screenshot?.url
  const imageUrl = screenshotUrl || bookmark.cover_image || bookmark.favicon || getFaviconUrl(bookmark.url)
  const domain = (() => {
    try {
      return new URL(bookmark.url).hostname.replace(/^www\./, '')
    } catch {
      return bookmark.url
    }
  })()
  const noValue = t('experimental.hoverCard.card.never')

  return (
    <article
      className={`bookmark-tcg-card bookmark-tcg-card--${settings.theme} bookmark-tcg-card--${rarity} bookmark-tcg-card--effect-${effect} ${className}`.trim()}
      style={style}
    >
      <div className="bookmark-tcg-card__effect" />
      <div className="bookmark-tcg-card__sparkles" />

      <div className="bookmark-tcg-card__frame">
        <header className="bookmark-tcg-card__header">
          <div className="min-w-0">
            <div className="bookmark-tcg-card__series">
              MV · {bookmark.id.slice(0, 8).toUpperCase()}
            </div>
            <h2>{bookmark.title || domain}</h2>
          </div>
          <div className={`bookmark-tcg-card__rarity bookmark-tcg-card__rarity--${rarity}`}>
            <Sparkles className="h-3.5 w-3.5" />
            {t(`experimental.hoverCard.rarities.${rarity}`)}
          </div>
        </header>

        <div className={`bookmark-tcg-card__artwork${screenshotUrl ? ' is-screenshot' : ''}`}>
          <img
            src={imageUrl}
            alt=""
            className={screenshotUrl ? 'is-screenshot' : bookmark.cover_image ? 'is-cover' : 'is-icon'}
          />
          <div className="bookmark-tcg-card__domain">
            <Globe2 className="h-3.5 w-3.5" />
            <CardUrl value={domain} privacy={urlPrivacy} />
          </div>
        </div>

        <div className="bookmark-tcg-card__stats">
          <div><Eye /><strong>{bookmark.click_count ?? 0}</strong><span>{t('experimental.hoverCard.card.visits')}</span></div>
          <div><Tags /><strong>{bookmark.tags?.length ?? 0}</strong><span>{t('experimental.hoverCard.card.tags')}</span></div>
          <div><Camera /><strong>{bookmark.snapshot_count ?? (bookmark.has_snapshot ? 1 : 0)}</strong><span>{t('experimental.hoverCard.card.snapshots')}</span></div>
        </div>

        <div className="bookmark-tcg-card__details">
          <div className="bookmark-tcg-card__url">
            <Globe2 />
            <CardUrl value={bookmark.url} privacy={urlPrivacy} />
          </div>
          <div className="bookmark-tcg-card__description">
            {bookmark.description || t('experimental.hoverCard.card.noDescription')}
          </div>

          {bookmark.ai_summary && (
            <div className="bookmark-tcg-card__summary">
              <span>AI</span>
              <p>{bookmark.ai_summary}</p>
            </div>
          )}

          {bookmark.tags?.length > 0 && (
            <div className="bookmark-tcg-card__tags">
              {bookmark.tags.map((tag) => (
                <span key={tag.id} style={{ '--tag-color': tag.color || settings.accentColor } as CSSProperties}>
                  {tag.name}
                </span>
              ))}
            </div>
          )}

          <div className="bookmark-tcg-card__status">
            {bookmark.is_pinned && <span><Pin />{t('experimental.hoverCard.card.pinned')}</span>}
            {bookmark.is_archived && <span><Archive />{t('experimental.hoverCard.card.archived')}</span>}
            <span><Globe2 />{t(`experimental.hoverCard.card.${bookmark.is_public ? 'public' : 'private'}`)}</span>
          </div>
        </div>

        <footer className="bookmark-tcg-card__footer">
          <div>
            <CalendarDays />
            <span>{t('experimental.hoverCard.card.created')}</span>
            <strong>{formatCardDate(bookmark.created_at, i18n.language, noValue)}</strong>
          </div>
          <div>
            <Sparkles />
            <span>{t('experimental.hoverCard.card.updated')}</span>
            <strong>{formatCardDate(bookmark.updated_at, i18n.language, noValue)}</strong>
          </div>
          <div>
            <Eye />
            <span>{t('experimental.hoverCard.card.lastVisited')}</span>
            <strong>{formatCardDate(bookmark.last_clicked_at, i18n.language, noValue)}</strong>
          </div>
        </footer>
      </div>
    </article>
  )
}
