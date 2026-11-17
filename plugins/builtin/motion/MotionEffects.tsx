import { useEffect } from 'react'

const RIPPLE_TARGETS = '.btn, .tag-item, .bookmark-card, .bookmark-list-item'
const POINTER_TARGETS = '.bookmark-card'
const POINTER_PROPERTIES = [
  '--motion-pointer-x',
  '--motion-pointer-y',
  '--motion-tilt-x',
  '--motion-tilt-y',
] as const

function clamp(value: number) {
  return Math.min(1, Math.max(0, value))
}

/**
 * 由脚本驱动的全局动效：点击涟漪与卡片跟随指针的倾斜/柔光。
 * 通过事件委托实现，组件无需逐个接入；是否生效以 <html> 上的 data-motion-* 属性为准，
 * 关闭动效或系统要求减少动态效果时立即停止。
 */
export function MotionEffects({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return
    const root = document.documentElement
    const timers = new Set<number>()

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || root.getAttribute('data-motion-buttons') !== 'on') return
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>(RIPPLE_TARGETS) : null
      if (!target || target.matches(':disabled, [aria-disabled="true"]')) return
      const rect = target.getBoundingClientRect()
      const x = event.clientX - rect.left - target.clientLeft
      const y = event.clientY - rect.top - target.clientTop
      // 半径取到最远角的距离，保证涟漪铺满整个元素
      const radius = Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y))
      const ripple = document.createElement('span')
      ripple.className = 'motion-ripple'
      ripple.setAttribute('aria-hidden', 'true')
      ripple.style.width = `${radius * 2}px`
      ripple.style.height = `${radius * 2}px`
      ripple.style.left = `${x - radius}px`
      ripple.style.top = `${y - radius}px`
      target.appendChild(ripple)
      const remove = () => ripple.remove()
      ripple.addEventListener('animationend', remove, { once: true })
      const timer = window.setTimeout(() => { timers.delete(timer); remove() }, 2000)
      timers.add(timer)
    }

    let frame = 0
    let pending: PointerEvent | null = null
    let current: HTMLElement | null = null

    const reset = (card: HTMLElement | null) => {
      if (!card) return
      for (const name of POINTER_PROPERTIES) card.style.removeProperty(name)
    }

    const update = () => {
      frame = 0
      const event = pending
      pending = null
      if (!event) return
      const mode = root.getAttribute('data-motion-card')
      const card =
        (mode === 'tilt' || mode === 'glow') && event.target instanceof Element
          ? event.target.closest<HTMLElement>(POINTER_TARGETS)
          : null
      if (current !== card) {
        reset(current)
        current = card
      }
      if (!card) return
      const rect = card.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      const px = clamp((event.clientX - rect.left) / rect.width)
      const py = clamp((event.clientY - rect.top) / rect.height)
      card.style.setProperty('--motion-pointer-x', `${(px * 100).toFixed(1)}%`)
      card.style.setProperty('--motion-pointer-y', `${(py * 100).toFixed(1)}%`)
      card.style.setProperty('--motion-tilt-x', ((px - 0.5) * 2).toFixed(3))
      card.style.setProperty('--motion-tilt-y', ((0.5 - py) * 2).toFixed(3))
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return
      pending = event
      if (!frame) frame = window.requestAnimationFrame(update)
    }

    const handlePointerOut = (event: PointerEvent) => {
      if (!current) return
      const next = event.relatedTarget
      if (next instanceof Node && current.contains(next)) return
      reset(current)
      current = null
    }

    document.addEventListener('pointerdown', handlePointerDown, { passive: true })
    document.addEventListener('pointermove', handlePointerMove, { passive: true })
    document.addEventListener('pointerout', handlePointerOut, { passive: true })
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerout', handlePointerOut)
      if (frame) window.cancelAnimationFrame(frame)
      for (const timer of timers) window.clearTimeout(timer)
      reset(current)
      document.querySelectorAll('.motion-ripple').forEach((ripple) => ripple.remove())
    }
  }, [enabled])

  return null
}
