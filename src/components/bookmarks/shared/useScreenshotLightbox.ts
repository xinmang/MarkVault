import { useCallback, useRef, useState } from 'react'
import type { Bookmark } from '@/lib/types'

/**
 * 网站截图灯箱的开关状态。
 *
 * 每个视图/条目各自持有一个实例，弹窗关闭时只渲染 null，开销很小；
 * 同一时刻只可能有一个弹窗处于打开状态。
 *
 * 打开时记住触发元素，关闭后把焦点还回去（键盘用户不会丢失位置）。
 */
export function useScreenshotLightbox() {
  const [bookmark, setBookmark] = useState<Bookmark | null>(null)
  const triggerRef = useRef<HTMLElement | null>(null)

  const open = useCallback((next: Bookmark) => {
    // 没有截图的书签不打开弹窗，避免渲染空状态
    if (!next.screenshot) return
    triggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    setBookmark(next)
  }, [])

  const close = useCallback(() => {
    setBookmark(null)
    const trigger = triggerRef.current
    triggerRef.current = null
    // 删除截图后触发元素可能已被移除，只在仍挂载时恢复焦点
    if (trigger?.isConnected) trigger.focus({ preventScroll: true })
  }, [])

  return {
    bookmark,
    isOpen: bookmark !== null,
    open,
    close,
  }
}

export type ScreenshotLightboxController = ReturnType<typeof useScreenshotLightbox>
