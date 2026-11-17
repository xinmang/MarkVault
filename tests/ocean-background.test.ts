import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorldSnapshot } from '../plugins/builtin/ocean/engine/world'
import {
  effectiveOceanBackground,
  resolveOceanBackground,
  resolveOceanBackgroundScope,
} from '../src/lib/ocean-background'

let hidden = false
let nextFrame = 0
let width = 1200
let height = 800
const frames = new Map<number, FrameRequestCallback>()
const listeners = new Map<string, EventListener>()
const pointerListeners = new Map<string, EventListener>()
const disconnect = vi.fn()
let AsciiOceanEngine: typeof import('../src/lib/ascii-ocean').AsciiOceanEngine
let World: typeof import('../plugins/builtin/ocean/engine/world').World
let AsciiRenderer: typeof import('../plugins/builtin/ocean/engine/renderer').AsciiRenderer
const storage = new Map<string, string>()
const sessionStorage = {
  getItem: vi.fn((key: string) => storage.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
}
const context = { clearRect: vi.fn(), setTransform: vi.fn(), fillText: vi.fn(), fillRect: vi.fn() }
const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
  const id = ++nextFrame
  frames.set(id, callback)
  return id
})
const cancelAnimationFrame = vi.fn((id: number) => frames.delete(id))

function canvas() {
  return {
    width: 0,
    height: 0,
    getContext: () => context,
    getBoundingClientRect: () => ({ width, height }),
  } as unknown as HTMLCanvasElement
}

function runFrame(time: number) {
  const pending = [...frames.entries()]
  frames.clear()
  for (const [, callback] of pending) callback(time)
}

beforeEach(async () => {
  vi.resetModules()
  ;({ AsciiOceanEngine } = await import('../src/lib/ascii-ocean'))
  ;({ World } = await import('../plugins/builtin/ocean/engine/world'))
  ;({ AsciiRenderer } = await import('../plugins/builtin/ocean/engine/renderer'))
  hidden = false
  nextFrame = 0
  width = 1200
  height = 800
  frames.clear()
  listeners.clear()
  pointerListeners.clear()
  storage.clear()
  vi.clearAllMocks()
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
  const pointerTarget = {
    addEventListener: (type: string, listener: EventListener) =>
      pointerListeners.set(type, listener),
    removeEventListener: (type: string) => pointerListeners.delete(type),
  }
  vi.stubGlobal('window', {
    devicePixelRatio: 3,
    requestAnimationFrame,
    cancelAnimationFrame,
    sessionStorage,
    ...pointerTarget,
  })
  vi.stubGlobal('document', {
    documentElement: pointerTarget,
    get hidden() {
      return hidden
    },
    addEventListener: (type: string, listener: EventListener) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
  })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect = disconnect
    }
  )
})

function savedState(mode = 'mixed'): WorldSnapshot {
  return JSON.parse(storage.get('markvault:ocean-state:v1:' + mode)!) as WorldSnapshot
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('海洋背景', () => {
  it('账号模式跨浏览器使用同一选择，包括明确关闭', () => {
    const account = { ocean_background_scope: 'account', ocean_background: 'mixed' } as const
    expect(effectiveOceanBackground(account, 'sharks')).toBe('mixed')
    expect(effectiveOceanBackground(account, 'off')).toBe('mixed')
    expect(effectiveOceanBackground({ ...account, ocean_background: 'off' }, 'dolphins')).toBe(
      'off'
    )
  })

  it('跟随浏览器时保留每个浏览器的独立选择，旧账号沿用本地模式', () => {
    const browser = { ocean_background_scope: 'browser', ocean_background: 'mixed' } as const
    expect(effectiveOceanBackground(browser, 'sharks')).toBe('sharks')
    expect(effectiveOceanBackground(browser, 'dolphins')).toBe('dolphins')
    expect(effectiveOceanBackground(undefined, 'mixed')).toBe('mixed')
    expect(resolveOceanBackgroundScope('invalid')).toBe('browser')
    expect(effectiveOceanBackground({ ocean_background_scope: 'account' }, 'mixed')).toBe('off')
  })

  it('旧缓存和非法选项默认关闭，保留已选择的合法模式', () => {
    expect(resolveOceanBackground(undefined)).toBe('off')
    expect(resolveOceanBackground('unknown')).toBe('off')
    expect(resolveOceanBackground('mixed')).toBe('mixed')
  })

  it('静态模式绘制字符但不创建动画循环，并限制高分屏像素倍率', () => {
    const target = canvas()
    const engine = new AsciiOceanEngine(target, 'mixed', false, false)
    expect(target.width).toBe(1800)
    expect(target.height).toBe(1200)
    expect(context.fillText).toHaveBeenCalled()
    expect(requestAnimationFrame).not.toHaveBeenCalled()
    engine.destroy()
    expect(disconnect).toHaveBeenCalledTimes(1)
  })

  it('页面隐藏时取消动画，重新显示时只恢复一个循环', () => {
    const engine = new AsciiOceanEngine(canvas(), 'sharks', true, true)
    expect(frames.size).toBe(1)
    runFrame(100)
    runFrame(140)
    expect(frames.size).toBe(1)
    hidden = true
    listeners.get('visibilitychange')?.(new Event('visibilitychange'))
    expect(frames.size).toBe(0)
    hidden = false
    listeners.get('visibilitychange')?.(new Event('visibilitychange'))
    expect(frames.size).toBe(1)
    engine.destroy()
    expect(frames.size).toBe(0)
    expect(listeners.has('visibilitychange')).toBe(false)
    expect(pointerListeners.size).toBe(0)
  })

  it('手机宽度仍能绘制海豚，关闭模式不绘制动物', () => {
    width = 360
    height = 740
    const engine = new AsciiOceanEngine(canvas(), 'dolphins', false, false)
    expect(context.fillText).toHaveBeenCalled()
    engine.destroy()
    context.fillText.mockClear()
    context.fillRect.mockClear()
    const disabled = new AsciiOceanEngine(canvas(), 'off', true, false)
    expect(context.fillText).not.toHaveBeenCalled()
    expect(context.fillRect).not.toHaveBeenCalled()
    expect(frames.size).toBe(0)
    expect(listeners.size).toBe(0)
    expect(pointerListeners.size).toBe(0)
    disabled.destroy()
  })

  it('日夜切换只更换配色，鱼群对象、位置与动画循环保持连续', () => {
    const seed = vi.spyOn(World.prototype, 'seed')
    const render = vi.spyOn(AsciiRenderer.prototype, 'render')
    const engine = new AsciiOceanEngine(canvas(), 'mixed', true, false)
    runFrame(100)
    runFrame(140)
    const world = render.mock.calls.at(-1)![0]
    const before = world.snapshot()
    const pending = [...frames.keys()]
    for (const dark of [true, false, true]) {
      const calls = context.fillText.mock.calls.length
      engine.setOptions(true, dark)
      expect(context.fillText.mock.calls.length).toBeGreaterThan(calls)
      expect(world.snapshot()).toEqual(before)
      expect(render.mock.calls.at(-1)![0]).toBe(world)
      expect([...frames.keys()]).toEqual(pending)
    }
    expect(seed).toHaveBeenCalledTimes(1)
    runFrame(180)
    expect(world.time).toBeGreaterThan(before.time)
    expect(world.snapshot().sharks).not.toEqual(before.sharks)
    engine.destroy()
  })

  it('页面布局卸载再挂载恢复同一批鱼的位置、速度、目标和摆尾相位', () => {
    const seed = vi.spyOn(World.prototype, 'seed')
    const render = vi.spyOn(AsciiRenderer.prototype, 'render')
    const first = new AsciiOceanEngine(canvas(), 'mixed', true, false)
    runFrame(100)
    runFrame(180)
    const world = render.mock.calls.at(-1)![0]
    world.sharks[0]!.target = world.fish[0]!
    world.fish[0]!.x = -20
    world.fish[1]!.alive = false
    world.fish[1]!.respawnAt = world.time + 3
    first.destroy()
    const before = savedState()
    expect(before.time).toBeGreaterThan(0)
    expect(before.sharks.some((shark) => shark.target !== null)).toBe(true)
    render.mockClear()
    const next = new AsciiOceanEngine(canvas(), 'mixed', true, false)
    const restored = render.mock.calls[0]![0]
    expect(restored.snapshot()).toEqual(before)
    expect(restored.sharks[0]!.target).toBe(restored.fish[0])
    expect(seed).toHaveBeenCalledTimes(1)
    expect(frames.size).toBe(1)
    runFrame(200)
    runFrame(240)
    next.destroy()
    expect(savedState().time).toBeGreaterThan(before.time)
    expect(savedState().sharks).not.toEqual(before.sharks)
    expect(frames.size).toBe(0)
  })

  it('pagehide 保存最新状态，刷新清空模块内存后仍从原位置继续', async () => {
    const first = new AsciiOceanEngine(canvas(), 'mixed', true, false)
    runFrame(100)
    runFrame(180)
    expect(sessionStorage.setItem).not.toHaveBeenCalled()
    pointerListeners.get('pagehide')?.(new Event('pagehide'))
    const before = savedState()
    expect(before.time).toBeGreaterThan(0)
    first.destroy()
    vi.resetModules()
    const { AsciiOceanEngine: ReloadedEngine } = await import('../src/lib/ascii-ocean')
    const { AsciiRenderer: ReloadedRenderer } =
      await import('../plugins/builtin/ocean/engine/renderer')
    const render = vi.spyOn(ReloadedRenderer.prototype, 'render')
    const reloaded = new ReloadedEngine(canvas(), 'mixed', true, true)
    expect(render.mock.calls[0]![0].snapshot()).toEqual(before)
    expect(frames.size).toBe(1)
    runFrame(300)
    runFrame(340)
    reloaded.destroy()
    expect(savedState().time).toBeGreaterThan(before.time)
  })

  it('关闭动效或减少动态效果时原地暂停，重新开启从原位置继续', () => {
    const render = vi.spyOn(AsciiRenderer.prototype, 'render')
    const engine = new AsciiOceanEngine(canvas(), 'mixed', true, false)
    runFrame(100)
    runFrame(140)
    const world = render.mock.calls.at(-1)![0]
    const before = world.snapshot()
    engine.setOptions(false, false)
    expect(frames.size).toBe(0)
    expect(pointerListeners.has('pointermove')).toBe(false)
    expect(world.snapshot()).toEqual(before)
    engine.setOptions(false, true)
    expect(world.snapshot()).toEqual(before)
    engine.setOptions(true, true)
    expect(frames.size).toBe(1)
    expect(pointerListeners.has('pointermove')).toBe(true)
    runFrame(200)
    runFrame(240)
    expect(world.time).toBeGreaterThan(before.time)
    engine.destroy()
    expect(pointerListeners.size).toBe(0)
    expect(listeners.size).toBe(0)
  })

  it('恢复静态画面时不额外推进模拟时间', () => {
    const first = new AsciiOceanEngine(canvas(), 'mixed', true, false)
    runFrame(100)
    runFrame(140)
    first.destroy()
    const before = savedState()
    const next = new AsciiOceanEngine(canvas(), 'mixed', false, false)
    next.destroy()
    expect(savedState()).toEqual(before)
    expect(frames.size).toBe(0)
  })

  it('隐藏时保存而不推进鱼群，恢复后继续游动且不重复注册循环', () => {
    const engine = new AsciiOceanEngine(canvas(), 'mixed', true, false)
    runFrame(100)
    runFrame(140)
    hidden = true
    listeners.get('visibilitychange')?.(new Event('visibilitychange'))
    const before = savedState()
    expect(frames.size).toBe(0)
    hidden = false
    listeners.get('visibilitychange')?.(new Event('visibilitychange'))
    listeners.get('visibilitychange')?.(new Event('visibilitychange'))
    expect(frames.size).toBe(1)
    runFrame(10000)
    runFrame(10040)
    engine.destroy()
    expect(savedState().time - before.time).toBeLessThan(0.1)
    expect(savedState().time).toBeGreaterThan(before.time)
  })

  it('禁用浏览器存储时仍通过内存保持站内切页进度', () => {
    sessionStorage.getItem.mockImplementationOnce(() => {
      throw new Error('禁止存储')
    })
    sessionStorage.setItem.mockImplementationOnce(() => {
      throw new Error('禁止存储')
    })
    const render = vi.spyOn(AsciiRenderer.prototype, 'render')
    const first = new AsciiOceanEngine(canvas(), 'mixed', true, false)
    runFrame(100)
    runFrame(140)
    const before = render.mock.calls.at(-1)![0].snapshot()
    first.destroy()
    expect(storage.size).toBe(0)
    const next = new AsciiOceanEngine(canvas(), 'mixed', true, true)
    expect(render.mock.calls.at(-1)![0].snapshot()).toEqual(before)
    next.destroy()
  })

  it.each(['无效 JSON', '{"width":100}', 'null'])('损坏缓存 %s 不影响正常生成和游动', (raw) => {
    storage.set('markvault:ocean-state:v1:mixed', raw)
    const engine = new AsciiOceanEngine(canvas(), 'mixed', true, false)
    expect(context.fillText).toHaveBeenCalled()
    runFrame(100)
    runFrame(140)
    engine.destroy()
    expect(savedState().time).toBeGreaterThan(0)
  })

  it('海洋样式分别保存，切换回来和关闭后重开不会重新生成原来的鱼群', () => {
    const first = new AsciiOceanEngine(canvas(), 'mixed', true, false)
    runFrame(100)
    runFrame(140)
    first.destroy()
    const before = savedState()
    const dolphins = new AsciiOceanEngine(canvas(), 'dolphins', false, false)
    dolphins.destroy()
    expect(savedState('dolphins').sharks.every((shark) => shark.kind === 'dolphin')).toBe(true)
    const disabled = new AsciiOceanEngine(canvas(), 'off', true, false)
    disabled.destroy()
    const next = new AsciiOceanEngine(canvas(), 'mixed', true, false)
    next.destroy()
    expect(savedState()).toEqual(before)
  })
})
