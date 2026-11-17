import { useEffect, useRef, useState } from 'react'

/**
 * 通过 ResizeObserver 跟踪元素宽度，供 SVG 图表自适应。
 * 初始宽度为 0，首次测量后立即更新，避免使用硬编码宽度。
 */
export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const update = (nextWidth: number) => {
      setWidth((current) => (Math.abs(current - nextWidth) < 0.5 ? current : nextWidth))
    }

    update(element.getBoundingClientRect().width)

    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const nextWidth = entry.contentRect.width || element.getBoundingClientRect().width
      update(nextWidth)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return { ref, width }
}
