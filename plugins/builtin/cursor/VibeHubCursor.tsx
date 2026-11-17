import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

const TEXT_TARGETS = [
  'textarea',
  '[contenteditable="true"]',
  'input:not([type="button"]):not([type="checkbox"]):not([type="color"]):not([type="file"]):not([type="radio"]):not([type="range"]):not([type="reset"]):not([type="submit"])',
].join(', ')

const INTERACTIVE_TARGETS = [
  'a',
  'button',
  'select',
  'label',
  'summary',
  '[role="button"]',
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '.bookmark-card',
  '.bookmark-list-item',
  '.tag-item',
  '[data-goto]',
].join(', ')

const NATIVE_CURSOR_TARGETS = [
  '.cursor-grab',
  '.cursor-grabbing',
  '.cursor-not-allowed',
  '[draggable="true"]',
  '[aria-disabled="true"]',
  ':disabled',
].join(', ')

function isScrollbarInteraction(event: MouseEvent) {
  if (!(event.target instanceof HTMLElement)) return false

  const element = event.target
  const style = window.getComputedStyle(element)
  const canScrollVertically = /^(auto|scroll|overlay)$/.test(style.overflowY)
  const canScrollHorizontally = /^(auto|scroll|overlay)$/.test(style.overflowX)
  const hasVerticalOverflow = canScrollVertically && element.scrollHeight > element.clientHeight
  const hasHorizontalOverflow = canScrollHorizontally && element.scrollWidth > element.clientWidth
  if (!hasVerticalOverflow && !hasHorizontalOverflow) return false

  const rect = element.getBoundingClientRect()
  const contentLeft = rect.left + element.clientLeft
  const contentTop = rect.top + element.clientTop
  const contentRight = contentLeft + element.clientWidth
  const contentBottom = contentTop + element.clientHeight
  const verticalScrollbarOnLeft = style.direction === 'rtl'

  const isOverVerticalScrollbar =
    hasVerticalOverflow &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom &&
    (verticalScrollbarOnLeft
      ? event.clientX >= rect.left && event.clientX < contentLeft
      : event.clientX >= contentRight && event.clientX <= rect.right)

  const isOverHorizontalScrollbar =
    hasHorizontalOverflow &&
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= contentBottom &&
    event.clientY <= rect.bottom

  return isOverVerticalScrollbar || isOverHorizontalScrollbar
}

export function VibeHubCursor({ enabled }: { enabled: boolean }) {
  const cursorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!enabled || !cursorRef.current) return

    const root = document.documentElement
    const cursor = cursorRef.current
    const finePointer = window.matchMedia('(pointer: fine)')
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let disposeCursor: (() => void) | undefined

    const enableCursor = () => {
      let frame = 0
      let hasMoved = false
      let x = 0
      let y = 0

      const renderPosition = () => {
        frame = 0
        cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`
        if (!hasMoved) {
          hasMoved = true
          cursor.classList.add('is-visible')
        }
      }

      const handleMove = (event: MouseEvent) => {
        x = event.clientX
        y = event.clientY
        updateTargetState(event)
        if (!frame) frame = window.requestAnimationFrame(renderPosition)
      }

      const updateTargetState = (event: MouseEvent) => {
        if (!(event.target instanceof Element)) return

        // 原生滚动条拖拽期间浏览器不会持续派发可用于同步自定义光标的移动事件。
        const useNativeCursor =
          isScrollbarInteraction(event) || event.target.closest(NATIVE_CURSOR_TARGETS) !== null
        const isText = !useNativeCursor && event.target.closest(TEXT_TARGETS) !== null
        const isInteractive =
          !useNativeCursor && !isText && event.target.closest(INTERACTIVE_TARGETS) !== null

        cursor.classList.toggle('is-native', useNativeCursor)
        cursor.classList.toggle('is-text', isText)
        cursor.classList.toggle('is-interactive', isInteractive)
      }

      const handlePointerDown = () => cursor.classList.add('is-pressed')
      const handlePointerUp = () => cursor.classList.remove('is-pressed')
      const handleLeave = () => {
        hasMoved = false
        cursor.classList.remove(
          'is-visible',
          'is-interactive',
          'is-text',
          'is-native',
          'is-pressed'
        )
      }

      root.classList.add('vibehub-cursor-active')
      window.addEventListener('mousemove', handleMove, { passive: true })
      window.addEventListener('mouseover', updateTargetState, { passive: true })
      window.addEventListener('mousedown', handlePointerDown, { passive: true })
      window.addEventListener('mouseup', handlePointerUp, { passive: true })
      window.addEventListener('blur', handleLeave)
      root.addEventListener('mouseleave', handleLeave)

      return () => {
        window.removeEventListener('mousemove', handleMove)
        window.removeEventListener('mouseover', updateTargetState)
        window.removeEventListener('mousedown', handlePointerDown)
        window.removeEventListener('mouseup', handlePointerUp)
        window.removeEventListener('blur', handleLeave)
        root.removeEventListener('mouseleave', handleLeave)
        if (frame) window.cancelAnimationFrame(frame)
        root.classList.remove('vibehub-cursor-active')
        handleLeave()
      }
    }

    const syncCursor = () => {
      disposeCursor?.()
      disposeCursor = undefined
      if (finePointer.matches && !reducedMotion.matches) {
        disposeCursor = enableCursor()
      }
    }

    syncCursor()
    finePointer.addEventListener('change', syncCursor)
    reducedMotion.addEventListener('change', syncCursor)

    return () => {
      finePointer.removeEventListener('change', syncCursor)
      reducedMotion.removeEventListener('change', syncCursor)
      disposeCursor?.()
    }
  }, [enabled])

  if (!enabled || typeof document === 'undefined') return null

  return createPortal(
    <div ref={cursorRef} className="vibehub-cursor" aria-hidden="true">
      <svg className="vibehub-cursor__arrow" viewBox="0 0 24 24" width="22" height="22">
        <path d="M5.5 3.2 L18.8 11.4 L12.6 12.8 L9.9 19.6 Z" />
      </svg>
      <i className="vibehub-cursor__state" />
    </div>,
    document.body
  )
}
