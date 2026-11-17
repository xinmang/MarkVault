import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PageLoadTracker,
  formatLoadTime,
  readDocumentMetrics,
  observePageNavigations,
} from '../plugins/builtin/page-speed/metrics'

describe('浏览器加载时间', () => {
  it('从导航起点计算，事件未完成时不显示 0 ms', () => {
    expect(readDocumentMetrics()).toMatchObject({ status: 'unsupported' })
    expect(
      readDocumentMetrics({
        startTime: 0,
        responseStart: 0,
        domContentLoadedEventEnd: 0,
        loadEventEnd: 0,
      })
    ).toMatchObject({ status: 'measuring', duration: undefined, ttfb: undefined })
    expect(
      readDocumentMetrics(
        { startTime: 50, responseStart: 150, domContentLoadedEventEnd: 650, loadEventEnd: 1250 },
        350
      )
    ).toEqual({
      kind: 'document',
      status: 'complete',
      duration: 1200,
      ttfb: 100,
      domReady: 600,
      firstPaint: 300,
    })
  })
  it('毫秒与秒保持清晰精度，缺失数据不伪装成零', () => {
    expect(formatLoadTime(42.4)).toBe('42 ms')
    expect(formatLoadTime(1256)).toBe('1.26 s')
    for (const value of [undefined, NaN, Infinity, -1]) expect(formatLoadTime(value)).toBe('—')
  })
})

describe('加载测量生命周期', () => {
  let now: number
  let hidden: boolean
  let navigation:
    | {
        startTime: number
        responseStart: number
        domContentLoadedEventEnd: number
        loadEventEnd: number
      }
    | undefined
  let serial: number
  let tracker: PageLoadTracker
  const frames = new Map<number, FrameRequestCallback>()
  const events = new Map<string, () => void>()
  function paint() {
    const pending = [...frames.values()]
    frames.clear()
    pending.forEach((callback) => callback(now))
  }
  beforeEach(() => {
    vi.useFakeTimers()
    now = 5000
    hidden = false
    serial = 0
    frames.clear()
    events.clear()
    navigation = {
      startTime: 0,
      responseStart: 50,
      domContentLoadedEventEnd: 100,
      loadEventEnd: 240,
    }
    const target = {
      addEventListener: (name: string, fn: () => void) => events.set(name, fn),
      removeEventListener: (name: string) => events.delete(name),
    }
    vi.stubGlobal('document', {
      ...target,
      get hidden() {
        return hidden
      },
    })
    vi.stubGlobal('window', {
      ...target,
      setTimeout,
      clearTimeout,
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        frames.set(++serial, callback)
        return serial
      },
      cancelAnimationFrame: (id: number) => frames.delete(id),
    })
    vi.stubGlobal('performance', {
      now: () => now,
      getEntriesByType: () => (navigation ? [navigation] : []),
      getEntriesByName: () => [{ startTime: 80 }],
    })
    tracker = new PageLoadTracker()
  })
  afterEach(() => {
    tracker.dispose()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })
  it('晚加载插件仍读取真实导航耗时，不把插件挂载时间算入加载', () => {
    tracker.start('/first', true)
    tracker.committed('/first')
    paint()
    paint()
    expect(tracker.getSnapshot()).toMatchObject({
      kind: 'document',
      status: 'complete',
      duration: 240,
    })
    expect(events.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('等待 loadEventEnd 更新到下一任务，再结束测量', () => {
    navigation!.loadEventEnd = 0
    tracker.start('/', true)
    tracker.committed('/')
    paint()
    paint()
    expect(tracker.getSnapshot().status).toBe('measuring')
    events.get('load')!()
    navigation!.loadEventEnd = 800
    vi.advanceTimersByTime(0)
    expect(tracker.getSnapshot().duration).toBe(800)
  })
  it('页面模块未提交时不提前结束，缓存页面也测量绘制机会', () => {
    tracker.start('/next', false)
    now = 5600
    paint()
    paint()
    expect(tracker.getSnapshot().status).toBe('measuring')
    tracker.committed('/next')
    paint()
    now = 5640
    paint()
    expect(tracker.getSnapshot()).toEqual({ kind: 'route', status: 'complete', duration: 640 })
  })
  it('快速切页取消旧任务，不能由过期页面提交结束新测量', () => {
    tracker.start('/a', false)
    tracker.committed('/a')
    paint()
    now = 5100
    tracker.start('/b', false)
    tracker.committed('/a')
    paint()
    expect(tracker.getSnapshot().status).toBe('measuring')
    tracker.committed('/b')
    paint()
    now = 5140
    paint()
    expect(tracker.getSnapshot().duration).toBe(40)
  })
  it('React 延迟提交不重置 history 捕获的起点', () => {
    tracker.start('/lazy', false)
    now = 5600
    tracker.start('/lazy', false)
    tracker.committed('/lazy')
    paint()
    now = 5640
    paint()
    expect(tracker.getSnapshot().duration).toBe(640)
  })
  it('捕获程序导航和前进后退，忽略锚点并在停用时还原 history', () => {
    const location = { pathname: '/', search: '' }
    const push = vi.fn((_data, _unused, url: string) => {
      location.pathname = url
    })
    const replace = vi.fn((_data, _unused, url: string) => {
      location.search = url
    })
    Object.assign(window, { location, history: { pushState: push, replaceState: replace } })
    const start = vi.spyOn(tracker, 'start')
    const stop = observePageNavigations(tracker)
    window.history.pushState({}, '', '/next')
    expect(start).toHaveBeenLastCalledWith('/next', false)
    window.history.replaceState({}, '', '?page=2')
    expect(start).toHaveBeenLastCalledWith('/next?page=2', false)
    start.mockClear()
    events.get('popstate')!()
    expect(start).not.toHaveBeenCalled()
    location.pathname = '/'
    location.search = ''
    events.get('popstate')!()
    expect(start).toHaveBeenCalledWith('/', false)
    stop()
    expect(window.history.pushState).toBe(push)
    expect(window.history.replaceState).toBe(replace)
    expect(events.has('popstate')).toBe(false)
  })
  it('中途启用等待下一次导航', () => {
    tracker.waitForNavigation()
    tracker.committed('/old')
    paint()
    paint()
    expect(tracker.getSnapshot().status).toBe('waiting')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('后台标签页丢弃结果，超时和缺失 API 均不伪造读数', () => {
    tracker.start('/', false)
    hidden = true
    events.get('visibilitychange')!()
    expect(tracker.getSnapshot().status).toBe('interrupted')
    hidden = false
    tracker.start('/slow', false)
    vi.advanceTimersByTime(30000)
    expect(tracker.getSnapshot().status).toBe('timeout')
    tracker.start('/slow', false)
    tracker.committed('/slow')
    paint()
    paint()
    expect(tracker.getSnapshot().status).toBe('timeout')
    navigation = undefined
    tracker.start('/', true)
    tracker.committed('/')
    paint()
    paint()
    expect(tracker.getSnapshot().status).toBe('unsupported')
  })
  it('停用释放定时器、绘制任务、事件和订阅', () => {
    const listener = vi.fn()
    tracker.subscribe(listener)
    tracker.start('/', false)
    tracker.committed('/')
    paint()
    tracker.dispose()
    expect(frames.size).toBe(0)
    expect(events.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    listener.mockClear()
    tracker.waitForNavigation()
    expect(listener).not.toHaveBeenCalled()
  })
  it('StrictMode 清理后同一页面可重新启动计时', () => {
    tracker.start('/', true)
    tracker.dispose()
    tracker.start('/', true)
    tracker.committed('/')
    paint()
    paint()
    expect(tracker.getSnapshot().status).toBe('complete')
  })
})
