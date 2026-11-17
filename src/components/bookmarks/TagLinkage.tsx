import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type FocusEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import type { ViewMode } from '@/lib/constants/bookmarks'

interface TagLinkageValue {
  /** 当前已选中的标签，用于给卡片上的标签芯片标出选中状态 */
  selectedTagIds: ReadonlySet<string>
  /** 点击卡片上的标签芯片切换筛选；批量模式下为空 */
  onToggleTag?: (tagId: string) => void
}

const TagLinkageContext = createContext<TagLinkageValue | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useTagLinkage() {
  return useContext(TagLinkageContext)
}

/** 卡片根元素上用于联动与入场动画的属性 */
// eslint-disable-next-line react-refresh/only-export-components
export function bookmarkLinkAttributes(
  bookmark: { tags?: Array<{ id: string }> },
  view: ViewMode
) {
  return {
    'data-bookmark-tags': (bookmark.tags ?? []).map((tag) => tag.id).join(' '),
    ...(view === 'collectible' ? {} : { 'data-motion-item': view }),
  }
}

function markElement(marked: Set<Element>, element: Element) {
  element.setAttribute('data-link-state', 'match')
  marked.add(element)
}

interface TagLinkageRootProps {
  enabled: boolean
  selectedTags: string[]
  onToggleTag?: (tagId: string) => void
  className?: string
  children: ReactNode
}

/**
 * 标签与书签联动：悬停（或键盘聚焦）标签时高亮带有该标签的书签并淡化其余书签，
 * 悬停书签时高亮它的标签。只通过事件委托读写 data-* 属性，不触发 React 重新渲染。
 */
export function TagLinkageRoot({
  enabled,
  selectedTags,
  onToggleTag,
  className,
  children,
}: TagLinkageRootProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const marked = useRef(new Set<Element>())
  const activeKey = useRef('')
  const clearTimer = useRef<number | undefined>(undefined)

  const clear = useCallback(() => {
    for (const element of marked.current) element.removeAttribute('data-link-state')
    marked.current.clear()
    rootRef.current?.removeAttribute('data-link-mode')
    activeKey.current = ''
  }, [])

  const previewTag = useCallback(
    (tagId: string) => {
      const root = rootRef.current
      const key = `tag:${tagId}`
      if (!root || activeKey.current === key) return
      clear()
      activeKey.current = key
      root.setAttribute('data-link-mode', 'tag')
      root.querySelectorAll<HTMLElement>('[data-bookmark-tags]').forEach((element) => {
        if ((element.dataset.bookmarkTags ?? '').split(' ').includes(tagId)) {
          markElement(marked.current, element)
        }
      })
      root.querySelectorAll<HTMLElement>('[data-link-tag]').forEach((element) => {
        if (element.dataset.linkTag === tagId) markElement(marked.current, element)
      })
    },
    [clear]
  )

  const previewBookmark = useCallback(
    (card: HTMLElement) => {
      const root = rootRef.current
      const tagIds = (card.dataset.bookmarkTags ?? '').split(' ').filter(Boolean)
      const key = `bookmark:${tagIds.join(',')}`
      if (!root || tagIds.length === 0) {
        clear()
        return
      }
      if (activeKey.current === key && marked.current.has(card)) return
      clear()
      activeKey.current = key
      root.setAttribute('data-link-mode', 'bookmark')
      markElement(marked.current, card)
      root.querySelectorAll<HTMLElement>('.tag-item[data-link-tag]').forEach((element) => {
        if (tagIds.includes(element.dataset.linkTag ?? '')) markElement(marked.current, element)
      })
    },
    [clear]
  )

  // 指针在相邻元素之间移动时会先离开再进入，延迟清除可避免高亮闪烁
  const scheduleClear = useCallback(() => {
    window.clearTimeout(clearTimer.current)
    clearTimer.current = window.setTimeout(clear, 90)
  }, [clear])

  const preview = useCallback(
    (target: EventTarget | null) => {
      if (!enabled || !(target instanceof Element)) return
      window.clearTimeout(clearTimer.current)
      const tag = target.closest<HTMLElement>('[data-link-tag]')
      if (tag?.dataset.linkTag && rootRef.current?.contains(tag)) {
        previewTag(tag.dataset.linkTag)
        return
      }
      const card = target.closest<HTMLElement>('[data-bookmark-tags]')
      if (card && rootRef.current?.contains(card)) {
        previewBookmark(card)
        return
      }
      scheduleClear()
    },
    [enabled, previewBookmark, previewTag, scheduleClear]
  )

  useEffect(() => {
    if (!enabled) clear()
  }, [clear, enabled])

  useEffect(
    () => () => {
      window.clearTimeout(clearTimer.current)
    },
    []
  )

  const value = useMemo<TagLinkageValue | null>(
    () => (enabled ? { selectedTagIds: new Set(selectedTags), onToggleTag } : null),
    [enabled, onToggleTag, selectedTags]
  )

  return (
    <TagLinkageContext.Provider value={value}>
      <div
        ref={rootRef}
        className={className}
        onPointerOver={(event: PointerEvent) => {
          if (event.pointerType === 'mouse') preview(event.target)
        }}
        onPointerLeave={() => enabled && scheduleClear()}
        onFocus={(event: FocusEvent) => preview(event.target)}
        onBlur={() => enabled && scheduleClear()}
      >
        {children}
      </div>
    </TagLinkageContext.Provider>
  )
}
