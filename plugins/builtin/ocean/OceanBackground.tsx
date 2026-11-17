import { useEffect, useRef } from 'react'
import { useThemeStore } from '@/stores/themeStore'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useExperimentalFeatures } from '@/contexts/ExperimentalFeaturesContext'
import type { OceanBackgroundMode } from '@/lib/ocean-background'
import type { AsciiOceanEngine } from './engine'

export function OceanBackground({ mode }: { mode: OceanBackgroundMode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<AsciiOceanEngine | null>(null)
  const theme = useThemeStore((state) => state.theme)
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const { motion } = useExperimentalFeatures()
  const animated = motion.enabled && !reducedMotion
  const optionsRef = useRef({ animated, dark: theme === 'dark' })

  useEffect(() => {
    optionsRef.current = { animated, dark: theme === 'dark' }
    engineRef.current?.setOptions(animated, theme === 'dark')
  }, [animated, theme])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || mode === 'off') return
    let cancelled = false
    let destroy: (() => void) | undefined
    // 关闭状态不加载渲染代码，也不创建动画循环。
    void import('@/lib/ascii-ocean').then(({ AsciiOceanEngine }) => {
      if (cancelled) return
      // 异步加载期间也可能切换主题，使用最新设置创建引擎。
      const { animated, dark } = optionsRef.current
      const engine = new AsciiOceanEngine(canvas, mode, animated, dark)
      engineRef.current = engine
      destroy = () => {
        engine.destroy()
        if (engineRef.current === engine) engineRef.current = null
      }
    })
    return () => {
      cancelled = true
      destroy?.()
    }
  }, [mode])

  if (mode === 'off') return null
  return <canvas ref={canvasRef} className="ocean-background" aria-hidden="true" />
}
