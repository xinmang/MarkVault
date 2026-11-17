import { flushSync } from 'react-dom'
import { useThemeStore } from '@/stores/themeStore'

/** 扩散动画基准时长，随“动效速度”设置缩放 */
const REVEAL_DURATION_MS = 620

/** 圆形扩散需要覆盖整个视口：取起点到四个角中最远的距离 */
export function themeRevealRadius(x: number, y: number, width: number, height: number): number {
  return Math.ceil(Math.hypot(Math.max(x, width - x), Math.max(y, height - y)))
}

function motionAllowed(root: HTMLElement): boolean {
  // 登录后由动效设置写入 data-motion；公开页没有该属性，只看系统“减少动态效果”
  if (root.getAttribute('data-motion') === 'off') return false
  return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/**
 * 切换明暗模式。支持 View Transitions 的浏览器里，新主题从 origin（切换按钮中心）
 * 以圆形向外扩散铺满页面；不支持、关闭动效或系统要求减少动态效果时直接切换。
 */
export function toggleThemeWithTransition(origin?: { x: number; y: number }): void {
  const root = document.documentElement
  const apply = () => {
    // 同步提交 React 更新，保证浏览器截取“新画面”时主题已经生效
    flushSync(() => useThemeStore.getState().toggleTheme())
    root.setAttribute('data-theme', useThemeStore.getState().theme)
  }

  if (typeof document.startViewTransition !== 'function' || !motionAllowed(root)) {
    apply()
    return
  }

  const x = origin?.x ?? window.innerWidth / 2
  const y = origin?.y ?? 0
  const radius = themeRevealRadius(x, y, window.innerWidth, window.innerHeight)
  const speed = Number.parseFloat(root.style.getPropertyValue('--motion-speed')) || 1

  // 只在本次切换期间关闭默认的淡入淡出，不影响其他视图过渡
  root.setAttribute('data-theme-transition', '')
  const cleanup = () => root.removeAttribute('data-theme-transition')
  const transition = document.startViewTransition(apply)
  transition.ready
    .then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        {
          duration: REVEAL_DURATION_MS * speed,
          // 半径匀速起步、平缓收尾：圆面积随半径平方增长，起步过快会显得一闪而过
          easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
          pseudoElement: '::view-transition-new(root)',
        }
      )
    })
    .catch(() => {
      // 过渡被跳过（例如页面隐藏）时主题已经切换，无需处理
    })
  transition.finished.then(cleanup, cleanup)
}
