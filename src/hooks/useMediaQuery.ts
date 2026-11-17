import { useState, useEffect } from 'react'

/**
 * 响应式媒体查询 Hook
 * 用于检测当前屏幕尺寸
 */
export function useMediaQuery(query: string): boolean {
  // 首次渲染就读取真实结果，避免先按 false 渲染再跳变（例如减少动态效果的用户看到一帧动画）
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches
  )

  useEffect(() => {
    const media = window.matchMedia(query)
    
    // 初始化
    setMatches(media.matches)

    // 监听变化
    const listener = (e: MediaQueryListEvent) => {
      setMatches(e.matches)
    }

    // 兼容旧版浏览器
    if (media.addEventListener) {
      media.addEventListener('change', listener)
    } else {
      media.addListener(listener)
    }

    return () => {
      if (media.removeEventListener) {
        media.removeEventListener('change', listener)
      } else {
        media.removeListener(listener)
      }
    }
  }, [query])

  return matches
}

/**
 * 预定义的断点 Hooks
 */
export function useIsMobile() {
  return useMediaQuery('(max-width: 767px)')
}

export function useIsTablet() {
  return useMediaQuery('(min-width: 768px) and (max-width: 1023px)')
}

export function useIsDesktop() {
  return useMediaQuery('(min-width: 1024px)')
}

/**
 * 获取当前设备类型
 */
export function useDeviceType(): 'mobile' | 'tablet' | 'desktop' {
  const isMobile = useIsMobile()
  const isTablet = useIsTablet()
  
  if (isMobile) return 'mobile'
  if (isTablet) return 'tablet'
  return 'desktop'
}

