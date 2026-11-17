import { useEffect, type RefObject } from 'react'
import { useLocation } from 'react-router-dom'

let firstPage = true

/**
 * 切换页面时让内容区淡入。只改变透明度：内容区里有 position: fixed 的标签侧栏，
 * transform 会改变它的定位基准并造成跳动。首次打开应用时不播放。
 */
export function usePageTransition<T extends HTMLElement>(ref: RefObject<T | null>) {
  const { pathname } = useLocation()

  useEffect(() => {
    if (firstPage) {
      firstPage = false
      return
    }
    const element = ref.current
    const root = document.documentElement
    if (!element || root.getAttribute('data-motion-page') !== 'on' || typeof element.animate !== 'function') {
      return
    }
    const scale = Number.parseFloat(root.style.getPropertyValue('--motion-speed')) || 1
    const animation = element.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 240 * scale,
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    })
    return () => animation.cancel()
  }, [pathname, ref])
}
