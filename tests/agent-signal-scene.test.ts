import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSignalScene } from '../src/pages/agent/signal-scene'

vi.mock('../plugins/builtin/ocean/engine/renderer', () => ({
  AsciiRenderer: class {
    cellWidth = 8
    cellHeight = 12
    resize() {}
    render() {}
  },
}))
vi.mock('../plugins/builtin/ocean/engine/world', () => ({
  World: class {
    time = 0
    sharks = [{ nodes: new Float32Array([300, 200, 200, 200]), length: 100 }]
    resize() {}
    step(dt: number) {
      this.time += dt
    }
  },
}))

const frames = new Map<number, FrameRequestCallback>()
const events = new Map<string, () => void>()
let hidden = false
let serial = 0
let intersect: (entries: { isIntersecting: boolean }[]) => void
const disconnect = vi.fn()
const drawImage = vi.fn()
const context = new Proxy(
  { drawImage },
  { get: (target, key) => (key in target ? target[key as 'drawImage'] : vi.fn()), set: () => true }
)
const canvas = {
  getContext: () => context,
  getBoundingClientRect: () => ({ width: 600 }),
  width: 0,
  height: 0,
} as unknown as HTMLCanvasElement

beforeEach(() => {
  frames.clear()
  events.clear()
  hidden = false
  serial = 0
  vi.clearAllMocks()
  vi.stubGlobal('window', { devicePixelRatio: 1 })
  vi.stubGlobal('document', {
    documentElement: {},
    createElement: () => canvas,
    get hidden() {
      return hidden
    },
    addEventListener: (name: string, callback: () => void) => events.set(name, callback),
    removeEventListener: (name: string) => events.delete(name),
  })
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }))
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++serial, callback)
    return serial
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect = disconnect
    }
  )
  vi.stubGlobal(
    'MutationObserver',
    class {
      observe() {}
      disconnect = disconnect
    }
  )
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: typeof intersect) {
        intersect = callback
      }
      observe() {}
      disconnect = disconnect
    }
  )
})
afterEach(() => vi.unstubAllGlobals())
function tick(time: number) {
  const pending = [...frames.values()]
  frames.clear()
  pending.forEach((callback) => callback(time))
}

describe('Agent 展示画布的生命周期', () => {
  it('静态偏好直接显示完整画面，不启动循环，重播也不绕过偏好', () => {
    const scene = createSignalScene(canvas)
    scene.configure(false, true)
    expect(drawImage).toHaveBeenCalled()
    expect(frames.size).toBe(0)
    scene.replay()
    expect(frames.size).toBe(0)
    scene.destroy()
  })
  it('暂停、离开视口、后台标签页与卸载均停止循环', () => {
    const scene = createSignalScene(canvas)
    scene.configure(false, false)
    expect(frames.size).toBe(1)
    scene.configure(true, false)
    expect(frames.size).toBe(0)
    scene.configure(false, false)
    intersect([{ isIntersecting: false }])
    expect(frames.size).toBe(0)
    intersect([{ isIntersecting: true }])
    expect(frames.size).toBe(1)
    hidden = true
    events.get('visibilitychange')!()
    expect(frames.size).toBe(0)
    hidden = false
    events.get('visibilitychange')!()
    expect(frames.size).toBe(1)
    scene.destroy()
    expect(frames.size).toBe(0)
    expect(events.size).toBe(0)
    expect(disconnect).toHaveBeenCalledTimes(3)
  })
  it('扫描完成后继续绘制同一画布，重播只重置开场', () => {
    const scene = createSignalScene(canvas)
    scene.configure(false, false)
    for (let i = 1; i < 300; i++) tick(i * 40)
    expect(drawImage).toHaveBeenCalled()
    expect(frames.size).toBe(1)
    const before = drawImage.mock.calls.length
    tick(12000)
    expect(drawImage.mock.calls.length).toBeGreaterThan(before)
    scene.replay()
    expect(frames.size).toBe(1)
    scene.destroy()
  })
})
