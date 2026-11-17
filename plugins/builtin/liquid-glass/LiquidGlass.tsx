import { useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { usePlugins } from '@/plugins/context'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { resolveLiquidGlassConfig } from './settings'
import type { GlassFusion } from './fusion'

/**
 * 液态玻璃主题里需要脚本的部分：把磨砂强度写成样式变量，并挂载融合图层
 * （指针水滴与按钮的吸附、融合，以及随指针移动的高光）。
 * 玻璃材质、配色和控件形状都在 style.css，由 <html data-experimental-ui="liquid-glass"> 启用。
 * animated 为 false（关闭动效或系统要求减少动态效果）时只保留静态的玻璃界面。
 */
export function LiquidGlass({ enabled, animated }: { enabled: boolean; animated: boolean }) {
  const { directory } = usePlugins()
  const { pathname } = useLocation()
  const finePointer = useMediaQuery('(pointer: fine)')
  const rawConfig = directory?.plugins.find(
    (item) => item.manifest.id === 'markvault.liquid-glass'
  )?.config
  // 匿名页和分享页没有插件目录，使用默认选项
  const config = useMemo(() => resolveLiquidGlassConfig(rawConfig), [rawConfig])

  const lens = useRef<HTMLDivElement>(null)
  const rim = useRef<SVGPathElement>(null)
  const fusion = useRef<GlassFusion | null>(null)
  // 分享页的访客读不到分享者的选项，指针水滴会盖在别人的页面上，分享页只保留随指针移动的高光
  const droplet = config.droplet && !pathname.startsWith('/share/')
  const interactive = enabled && animated && finePointer && (droplet || config.highlight)
  const options = useRef({ droplet, highlight: config.highlight, fusion: config.fusion })
  options.current = { droplet, highlight: config.highlight, fusion: config.fusion }

  useEffect(() => {
    if (!enabled) return
    const root = document.documentElement
    root.style.setProperty('--lg-frost', config.frost + 'px')
    return () => {
      root.style.removeProperty('--lg-frost')
    }
  }, [enabled, config.frost])

  // 融合图层：不需要时不加载计算代码
  useEffect(() => {
    if (!interactive || !lens.current || !rim.current) return
    const lensElement = lens.current
    const rimElement = rim.current
    let cancelled = false
    void import('./fusion').then(({ GlassFusion }) => {
      if (!cancelled) fusion.current = new GlassFusion(lensElement, rimElement, options.current)
    })
    return () => {
      cancelled = true
      fusion.current?.destroy()
      fusion.current = null
    }
  }, [interactive])

  useEffect(() => {
    fusion.current?.setOptions({ droplet, highlight: config.highlight, fusion: config.fusion })
  }, [droplet, config.highlight, config.fusion])

  if (!interactive || typeof document === 'undefined') return null
  return createPortal(
    <div className="lg-fusion" aria-hidden="true">
      <div ref={lens} className="lg-fusion__lens" />
      <svg className="lg-fusion__rim">
        <defs>
          <linearGradient id="lg-fusion-rim" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.95" />
            <stop offset="0.42" stopColor="#fff" stopOpacity="0.18" />
            <stop offset="0.62" stopColor="#fff" stopOpacity="0.08" />
            <stop offset="1" stopColor="#fff" stopOpacity="0.6" />
          </linearGradient>
        </defs>
        <path ref={rim} d="" />
      </svg>
    </div>,
    document.body
  )
}
