import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { Bookmark } from '@/lib/types'
import { useRecordBookmarkClick } from '@/hooks/useClickTracking'
import { useExperimentalFeatures } from '@/contexts/ExperimentalFeaturesContext'
import { BatchCheckbox, EditButton } from './shared/BookmarkActions'
import { BookmarkTradingCard } from './shared/BookmarkHoverCard'
import { useScreenshotLightbox } from './shared/useScreenshotLightbox'
import { BookmarkMediaButtons } from './shared/BookmarkMediaButtons'
import { ScreenshotLightbox } from './ScreenshotLightbox'
import { bookmarkLinkAttributes } from './TagLinkage'

interface BookmarkCollectibleViewProps {
  bookmarks: Bookmark[]
  onEdit?: (bookmark: Bookmark) => void
  readOnly?: boolean
  batchMode?: boolean
  selectedIds?: string[]
  onToggleSelect?: (id: string) => void
  isLoading?: boolean
  shuffleKey?: string
  settledShuffleKey?: string
  loadingState?: ReactNode
  emptyState?: ReactNode
}

type ShufflePhase = 'idle' | 'gather' | 'deal'

const GATHER_DURATION_MS = 460
const DEAL_DURATION_MS = 940

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function BookmarkCollectibleView({
  bookmarks,
  onEdit,
  readOnly = false,
  batchMode = false,
  selectedIds = [],
  onToggleSelect,
  isLoading = false,
  shuffleKey = '',
  settledShuffleKey = shuffleKey,
  loadingState,
  emptyState,
}: BookmarkCollectibleViewProps) {
  const recordClick = useRecordBookmarkClick(readOnly)
  const { hoverCard } = useExperimentalFeatures()
  const shuffleEnabled = hoverCard.enabled && hoverCard.shuffleEnabled
  const gridRef = useRef<HTMLDivElement>(null)
  const latestBookmarksRef = useRef(bookmarks)
  const previousShuffleKeyRef = useRef(shuffleKey)
  const pendingShuffleKeyRef = useRef<string | null>(null)
  const gatherTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const [displayedBookmarks, setDisplayedBookmarks] = useState(bookmarks)
  const [shufflePhase, setShufflePhase] = useState<ShufflePhase>('idle')
  const [shuffleActive, setShuffleActive] = useState(false)
  const [gatherComplete, setGatherComplete] = useState(false)
  const [shuffleSequence, setShuffleSequence] = useState(0)

  latestBookmarksRef.current = bookmarks

  const clearTimers = () => {
    if (gatherTimerRef.current) clearTimeout(gatherTimerRef.current)
    if (dealTimerRef.current) clearTimeout(dealTimerRef.current)
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current)
  }

  useEffect(() => {
    if (!shuffleEnabled || shufflePhase === 'idle') {
      setDisplayedBookmarks(bookmarks)
    }
  }, [bookmarks, shuffleEnabled, shufflePhase])

  useEffect(() => {
    const previousKey = previousShuffleKeyRef.current
    previousShuffleKeyRef.current = shuffleKey

    if (previousKey === shuffleKey) return

    clearTimers()

    if (!shuffleEnabled || prefersReducedMotion()) {
      pendingShuffleKeyRef.current = null
      setShuffleActive(false)
      setShufflePhase('idle')
      setDisplayedBookmarks(bookmarks)
      return
    }

    pendingShuffleKeyRef.current = shuffleKey
    setGatherComplete(false)
    setShuffleActive(false)
    setShufflePhase('gather')
    setShuffleSequence((sequence) => sequence + 1)
    gatherTimerRef.current = setTimeout(() => setGatherComplete(true), GATHER_DURATION_MS)
  }, [bookmarks, shuffleEnabled, shuffleKey])

  useEffect(() => {
    if (
      shufflePhase !== 'gather'
      || !gatherComplete
      || isLoading
      || pendingShuffleKeyRef.current !== settledShuffleKey
    ) return

    setDisplayedBookmarks(latestBookmarksRef.current)
    setShuffleActive(false)
    setShufflePhase('deal')
    setShuffleSequence((sequence) => sequence + 1)
    dealTimerRef.current = setTimeout(() => {
      pendingShuffleKeyRef.current = null
      setDisplayedBookmarks(latestBookmarksRef.current)
      setShuffleActive(false)
      setShufflePhase('idle')
    }, DEAL_DURATION_MS)
  }, [gatherComplete, isLoading, settledShuffleKey, shufflePhase])

  useLayoutEffect(() => {
    if (shufflePhase === 'idle' || !gridRef.current) return

    const gridRect = gridRef.current.getBoundingClientRect()
    const visibleTop = Math.max(0, gridRect.top)
    const visibleBottom = Math.min(window.innerHeight, gridRect.bottom)
    const stackCenterX = gridRect.left + gridRect.width / 2
    const stackCenterY = visibleBottom > visibleTop
      ? (visibleTop + visibleBottom) / 2
      : gridRect.top + Math.min(gridRect.height, window.innerHeight) / 2
    const items = gridRef.current.querySelectorAll<HTMLElement>('.bookmark-collectible-item')

    items.forEach((item, index) => {
      const itemRect = item.getBoundingClientRect()
      const offsetX = stackCenterX - (itemRect.left + itemRect.width / 2)
      const offsetY = stackCenterY - (itemRect.top + itemRect.height / 2)
      const rotation = ((index % 7) - 3) * 1.35
      item.style.setProperty('--shuffle-x', `${offsetX.toFixed(1)}px`)
      item.style.setProperty('--shuffle-y', `${offsetY.toFixed(1)}px`)
      item.style.setProperty('--shuffle-rotate', `${rotation.toFixed(2)}deg`)
      item.style.setProperty('--shuffle-delay', `${Math.min(index, 14) * 18}ms`)
      item.style.setProperty('--shuffle-z', String(items.length - index))
    })

    // 先提交牌堆位置，再于下一帧开始过渡，避免新牌直接出现在最终位置。
    void gridRef.current.offsetWidth
    animationFrameRef.current = requestAnimationFrame(() => setShuffleActive(true))

    return () => {
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current)
    }
  }, [displayedBookmarks, shufflePhase, shuffleSequence])

  useEffect(() => () => clearTimers(), [])

  const handleVisit = (bookmark: Bookmark) => {
    void recordClick(bookmark.id)
    window.open(bookmark.url, '_blank', 'noopener,noreferrer')
  }

  if (displayedBookmarks.length === 0) {
    return <>{isLoading ? loadingState : emptyState}</>
  }

  return (
    <div
      ref={gridRef}
      className={`bookmark-collectible-grid bookmark-collectible-grid--shuffle-${shufflePhase} ${shuffleActive ? 'is-active' : ''}`}
      aria-busy={shufflePhase !== 'idle' || isLoading}
    >
      {displayedBookmarks.map((bookmark) => (
        <BookmarkCollectibleItem
          key={bookmark.id}
          bookmark={bookmark}
          onEdit={onEdit ? () => onEdit(bookmark) : undefined}
          onVisit={() => handleVisit(bookmark)}
          readOnly={readOnly}
          batchMode={batchMode}
          isSelected={selectedIds.includes(bookmark.id)}
          onToggleSelect={onToggleSelect}
        />
      ))}
    </div>
  )
}

function BookmarkCollectibleItem({
  bookmark,
  onEdit,
  onVisit,
  readOnly,
  batchMode,
  isSelected,
  onToggleSelect,
}: {
  bookmark: Bookmark
  onEdit?: () => void
  onVisit: () => void
  readOnly: boolean
  batchMode: boolean
  isSelected: boolean
  onToggleSelect?: (id: string) => void
}) {
  const { t } = useTranslation('bookmarks')
  const { hoverCard, urlPrivacy } = useExperimentalFeatures()
  const screenshotLightbox = useScreenshotLightbox()
  const [pointer, setPointer] = useState({ x: 0.5, y: 0.5 })

  const activate = () => {
    if (batchMode && onToggleSelect) onToggleSelect(bookmark.id)
    else onVisit()
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse') return
    const rect = event.currentTarget.getBoundingClientRect()
    setPointer({
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width))),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height))),
    })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      activate()
    }
  }

  const actionClasses = [
    'bookmark-tcg-card--collection',
    batchMode && onToggleSelect ? 'bookmark-tcg-card--with-left-action' : '',
    onEdit && !batchMode ? 'bookmark-tcg-card--with-right-action' : '',
  ].filter(Boolean).join(' ')

  return (
    <>
    <div
      {...bookmarkLinkAttributes(bookmark, 'collectible')}
      className={`bookmark-collectible-item group ${batchMode && isSelected ? 'is-selected' : ''}`}
      role="link"
      tabIndex={0}
      aria-label={t('action.open', { title: bookmark.title })}
      aria-selected={batchMode ? isSelected : undefined}
      onClick={activate}
      onKeyDown={handleKeyDown}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setPointer({ x: 0.5, y: 0.5 })}
    >
      {batchMode && onToggleSelect && (
        <BatchCheckbox
          bookmarkId={bookmark.id}
          isSelected={isSelected}
          onToggleSelect={onToggleSelect}
        />
      )}
      {onEdit && !batchMode && <EditButton onEdit={onEdit} showHint={false} />}
      <BookmarkMediaButtons
        bookmark={bookmark}
        onOpenScreenshot={() => screenshotLightbox.open(bookmark)}
        readOnly={readOnly}
        className="bookmark-media-group--floating absolute bottom-3 right-3 z-10 gap-1"
        buttonClassName="w-8 h-8 shadow-md"
        iconClassName="w-4 h-4"
      />
      <BookmarkTradingCard
        bookmark={bookmark}
        settings={hoverCard}
        urlPrivacy={urlPrivacy}
        pointerX={pointer.x}
        pointerY={pointer.y}
        className={actionClasses}
      />
    </div>

    <ScreenshotLightbox
      bookmark={screenshotLightbox.bookmark}
      readOnly={readOnly}
      onClose={screenshotLightbox.close}
    />
    </>
  )
}
