import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { usePlugins } from '@/plugins/context'
import { useAuthStore } from '@/stores/authStore'
import { FRAME_VARIABLES, frameVariables } from './frame'
import { ASCII_BOOT_SESSION_KEY, resolveAsciiConfig } from './settings'
import { garbageGlyph } from './scene'
import type { AsciiBackdrop } from './renderer'

/** 启动序列总时长；扫描带离开画面（约 83%）后即结束。 */
const BOOT_DURATION_MS = 4200
const THEME_ATTRIBUTES = ['data-theme', 'data-color-theme', 'data-experimental-ui']

function bootAlreadyPlayed(): boolean {
  try {
    return window.sessionStorage.getItem(ASCII_BOOT_SESSION_KEY) === '1'
  } catch {
    // 隐私模式下读不到会话存储时不播放，避免每次切页都重播
    return true
  }
}

function rememberBoot() {
  try {
    window.sessionStorage.setItem(ASCII_BOOT_SESSION_KEY, '1')
  } catch {
    // 忽略：读不到存储时 bootAlreadyPlayed 已经阻止播放
  }
}

/**
 * ASCII 终端主题里需要脚本的部分：字符边框图、字符背景、启动序列和切页时的故障闪烁。
 * 配色、字体、按钮与边框样式都在 style.css，由 <html data-experimental-ui="ascii"> 启用。
 * animated 为 false（关闭动效或系统要求减少动态效果）时只保留静态画面。
 */
export function AsciiTheme({ enabled, animated }: { enabled: boolean; animated: boolean }) {
  const { directory, ready } = usePlugins()
  const user = useAuthStore((state) => state.user)
  const { pathname } = useLocation()
  const rawConfig = directory?.plugins.find(
    (item) => item.manifest.id === 'markvault.ascii'
  )?.config
  const config = useMemo(() => resolveAsciiConfig(rawConfig), [rawConfig])
  // 匿名页和分享页没有插件目录，直接使用默认选项；登录后等目录就绪再决定是否播放启动序列
  const onSharePage = pathname.startsWith('/share/')
  const configSettled = ready || !user || onSharePage

  const backdropCanvas = useRef<HTMLCanvasElement>(null)
  const bootCanvas = useRef<HTMLCanvasElement>(null)
  const backdrop = useRef<AsciiBackdrop | null>(null)
  const [booting, setBooting] = useState(false)
  const [glitch, setGlitch] = useState(0)

  const showBackdrop = enabled && config.background !== 'off'
  const backdropOptions = useRef({ mode: config.background, density: config.density, animated })
  backdropOptions.current = { mode: config.background, density: config.density, animated }

  // 扫描线与故障闪烁的开关交给样式判断
  useEffect(() => {
    if (!enabled) return
    const root = document.documentElement
    root.setAttribute('data-ascii-scanlines', config.scanlines ? 'on' : 'off')
    root.setAttribute('data-ascii-glitch', config.glitch ? 'on' : 'off')
    return () => {
      root.removeAttribute('data-ascii-scanlines')
      root.removeAttribute('data-ascii-glitch')
    }
  }, [enabled, config.scanlines, config.glitch])

  // 字符边框图要写死颜色，明暗或配色变化后按当前主题色重新生成
  useEffect(() => {
    if (!enabled) return
    const root = document.documentElement
    const apply = () => {
      const style = getComputedStyle(root)
      const read = (name: string, fallback: string) =>
        style.getPropertyValue(name).trim() || fallback
      const variables = frameVariables({
        line: read('--ascii-line', '#3a4a45'),
        accent: read('--primary', '#3df2cf'),
        ink: read('--muted-foreground', '#7d8f87'),
      })
      for (const [name, value] of Object.entries(variables)) root.style.setProperty(name, value)
      backdrop.current?.refresh()
    }
    apply()
    const observer = new MutationObserver(apply)
    observer.observe(root, { attributes: true, attributeFilter: THEME_ATTRIBUTES })
    return () => {
      observer.disconnect()
      for (const name of FRAME_VARIABLES) root.style.removeProperty(name)
    }
  }, [enabled])

  // 字符背景：关闭时不加载渲染代码
  useEffect(() => {
    const canvas = backdropCanvas.current
    if (!showBackdrop || !canvas) return
    let cancelled = false
    void import('./renderer').then(({ AsciiBackdrop }) => {
      if (cancelled) return
      const { mode, density, animated } = backdropOptions.current
      if (mode !== 'off') backdrop.current = new AsciiBackdrop(canvas, mode, density, animated)
    })
    return () => {
      cancelled = true
      backdrop.current?.destroy()
      backdrop.current = null
    }
  }, [showBackdrop])

  useEffect(() => {
    if (config.background !== 'off')
      backdrop.current?.setOptions(config.background, config.density, animated)
  }, [config.background, config.density, animated])

  // 启动序列：每个浏览器会话播放一次。
  // 分享页的访客读不到分享者的插件配置，分享者关掉启动序列也传不过去，所以分享页一律不播放
  useEffect(() => {
    if (!enabled || !animated || !configSettled || !config.boot || onSharePage) return
    if (bootAlreadyPlayed()) return
    rememberBoot()
    setBooting(true)
  }, [enabled, animated, configSettled, config.boot, onSharePage])

  useEffect(() => {
    const canvas = bootCanvas.current
    if (!booting || !canvas) return
    let cancelled = false
    let stop: (() => void) | undefined
    void import('./renderer').then(({ AsciiBoot }) => {
      if (cancelled) return
      const boot = new AsciiBoot(canvas, BOOT_DURATION_MS, () => setBooting(false))
      // 第一帧画好之前画布用纯黑底挡住界面，之后改由画布逐格揭开
      canvas.classList.remove('ascii-boot--loading')
      stop = () => boot.destroy()
    })
    return () => {
      cancelled = true
      stop?.()
    }
  }, [booting])

  // 中途关闭主题或动效时立即收起启动画面
  useEffect(() => {
    if (!enabled || !animated) setBooting(false)
  }, [enabled, animated])

  // 切换页面时闪一下横向错位；首次进入不闪
  const firstPath = useRef(true)
  useEffect(() => {
    if (firstPath.current) {
      firstPath.current = false
      return
    }
    if (enabled && animated && config.glitch) setGlitch((value) => value + 1)
  }, [pathname, enabled, animated, config.glitch])

  if (!enabled || typeof document === 'undefined') return null
  return createPortal(
    <>
      {showBackdrop && (
        <canvas
          ref={backdropCanvas}
          className="ascii-backdrop"
          data-mode={config.background}
          aria-hidden="true"
        />
      )}
      {glitch > 0 && animated && config.glitch && (
        <div
          key={glitch}
          className="ascii-glitch"
          aria-hidden="true"
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget) setGlitch(0)
          }}
        >
          {[0, 1, 2].map((band) => (
            <span key={band}>
              {Array.from({ length: 280 }, (_, index) => garbageGlyph(index, band, glitch)).join(
                ''
              )}
            </span>
          ))}
        </div>
      )}
      {booting && (
        <canvas ref={bootCanvas} className="ascii-boot ascii-boot--loading" aria-hidden="true" />
      )}
    </>,
    document.body
  )
}
