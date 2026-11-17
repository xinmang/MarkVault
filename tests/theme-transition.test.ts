import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { themeRevealRadius, toggleThemeWithTransition } from '../src/lib/theme-transition'
import { useThemeStore } from '../src/stores/themeStore'

/** 仓库的测试没有 DOM 环境，这里只模拟主题切换用到的几个 API */
function fakeRoot(attributes: Record<string, string> = {}) {
  const attrs = new Map(Object.entries(attributes))
  return {
    attrs,
    animate: vi.fn(),
    style: { getPropertyValue: (name: string) => (name === '--motion-speed' ? '0.5' : '') },
    getAttribute: (name: string) => attrs.get(name) ?? null,
    hasAttribute: (name: string) => attrs.has(name),
    setAttribute: (name: string, value: string) => void attrs.set(name, value),
    removeAttribute: (name: string) => void attrs.delete(name),
  }
}

function stubPage(root: ReturnType<typeof fakeRoot>, startViewTransition?: unknown, reducedMotion = false) {
  vi.stubGlobal('document', { documentElement: root, startViewTransition })
  vi.stubGlobal('window', {
    innerWidth: 1440,
    innerHeight: 900,
    matchMedia: () => ({ matches: reducedMotion }),
  })
}

beforeEach(() => {
  useThemeStore.setState({ theme: 'light', isAutoTheme: false })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('明暗切换扩散', () => {
  it('半径取起点到最远视口角的距离', () => {
    expect(themeRevealRadius(1400, 40, 1440, 900)).toBe(Math.ceil(Math.hypot(1400, 860)))
    expect(themeRevealRadius(720, 450, 1440, 900)).toBe(Math.ceil(Math.hypot(720, 450)))
  })

  it('浏览器不支持视图过渡时直接切换', () => {
    const root = fakeRoot()
    stubPage(root)
    toggleThemeWithTransition({ x: 10, y: 10 })
    expect(useThemeStore.getState().theme).toBe('dark')
    expect(root.getAttribute('data-theme')).toBe('dark')
    expect(root.animate).not.toHaveBeenCalled()
  })

  it('关闭动效或系统要求减少动态效果时不播放扩散', () => {
    const startViewTransition = vi.fn()
    stubPage(fakeRoot({ 'data-motion': 'off' }), startViewTransition)
    toggleThemeWithTransition()
    stubPage(fakeRoot(), startViewTransition, true)
    toggleThemeWithTransition()
    expect(startViewTransition).not.toHaveBeenCalled()
    expect(useThemeStore.getState().theme).toBe('light')
  })

  it('从按钮位置圆形扩散，结束后清理过渡标记', async () => {
    const root = fakeRoot({ 'data-motion': 'on' })
    let finish = () => {}
    const finished = new Promise<void>((resolve) => {
      finish = resolve
    })
    const startViewTransition = vi.fn((update: () => void) => {
      // 浏览器先截取旧画面再执行更新：此时过渡标记已经写入
      expect(root.hasAttribute('data-theme-transition')).toBe(true)
      update()
      return { ready: Promise.resolve(), finished }
    })
    stubPage(root, startViewTransition)

    toggleThemeWithTransition({ x: 1400, y: 40 })
    expect(useThemeStore.getState().theme).toBe('dark')
    expect(root.getAttribute('data-theme')).toBe('dark')

    await Promise.resolve()
    const [keyframes, options] = root.animate.mock.calls[0]
    const radius = themeRevealRadius(1400, 40, 1440, 900)
    expect(keyframes.clipPath).toEqual(['circle(0px at 1400px 40px)', `circle(${radius}px at 1400px 40px)`])
    expect(options).toMatchObject({ pseudoElement: '::view-transition-new(root)', duration: 310 })

    finish()
    await finished
    await Promise.resolve()
    expect(root.hasAttribute('data-theme-transition')).toBe(false)
  })
})
