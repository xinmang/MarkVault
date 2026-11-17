export type LoadKind = 'document' | 'route'
export type LoadStatus =
  'waiting' | 'measuring' | 'complete' | 'unsupported' | 'interrupted' | 'timeout'
export interface LoadMetrics {
  kind: LoadKind
  status: LoadStatus
  duration?: number
  ttfb?: number
  domReady?: number
  firstPaint?: number
}

type NavigationTiming = Pick<
  PerformanceNavigationTiming,
  'startTime' | 'responseStart' | 'domContentLoadedEventEnd' | 'loadEventEnd'
>

/** 仅使用浏览器已完成的时间点，0 表示事件尚未发生，不能伪装成零耗时。 */
export function readDocumentMetrics(navigation?: NavigationTiming, paint?: number): LoadMetrics {
  if (!navigation) return { kind: 'document', status: 'unsupported' }
  const relative = (value: number) =>
    Number.isFinite(value) && value > navigation.startTime
      ? value - navigation.startTime
      : undefined
  const duration = relative(navigation.loadEventEnd)
  return {
    kind: 'document',
    status: duration === undefined ? 'measuring' : 'complete',
    duration,
    ttfb: relative(navigation.responseStart),
    domReady: relative(navigation.domContentLoadedEventEnd),
    firstPaint: paint === undefined ? undefined : relative(paint),
  }
}

export function formatLoadTime(value?: number): string {
  if (value === undefined || !Number.isFinite(value) || value < 0) return '—'
  return value < 1000 ? Math.round(value) + ' ms' : (value / 1000).toFixed(2) + ' s'
}

/** 每次导航只测量到完成；不轮询、不上传，也不保存地址或历史。 */
export class PageLoadTracker {
  private snapshot: LoadMetrics = { kind: 'document', status: 'measuring' }
  private listeners = new Set<() => void>()
  private route = ''
  private started = 0
  private ready = false
  private timer = 0
  private loadTimer = 0
  private firstFrame = 0
  private secondFrame = 0

  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  waitForNavigation() {
    this.stop()
    this.publish({ kind: 'route', status: 'waiting' })
  }

  private publish(value: LoadMetrics) {
    this.snapshot = value
    this.listeners.forEach((listener) => listener())
  }

  start(route: string, initial: boolean) {
    // React 延迟提交不能重置 history 捕获的起点，也不能把超时重新计为快速完成。
    if (route === this.route) return
    this.stop()
    this.route = route
    this.ready = false
    const kind = initial ? 'document' : 'route'
    if (typeof performance === 'undefined' || typeof performance.now !== 'function') {
      this.publish({ kind, status: 'unsupported' })
      return
    }
    this.started = performance.now()
    this.publish({ kind, status: 'measuring' })
    if (document.hidden) {
      this.finish({ kind, status: 'interrupted' })
      return
    }
    document.addEventListener('visibilitychange', this.onVisibility)
    window.addEventListener('pagehide', this.onHidden)
    if (initial) window.addEventListener('load', this.onLoad)
    // 长时间加载保留明确状态，避免把超时当作完成时间。
    this.timer = window.setTimeout(() => this.finish({ kind, status: 'timeout' }), 30_000)
  }

  /** 调用方先等待路由内容提交；双帧包含一次浏览器绘制机会。 */
  committed(route: string) {
    if (route !== this.route || this.snapshot.status !== 'measuring') return
    this.cancelFrames()
    this.firstFrame = window.requestAnimationFrame(() => {
      this.secondFrame = window.requestAnimationFrame(() => {
        if (route !== this.route || this.snapshot.status !== 'measuring') return
        this.ready = true
        this.complete()
      })
    })
  }

  private complete() {
    if (!this.ready || this.snapshot.status !== 'measuring') return
    if (this.snapshot.kind === 'route') {
      this.finish({
        kind: 'route',
        status: 'complete',
        duration: Math.max(0, performance.now() - this.started),
      })
      return
    }
    const entries =
      typeof performance.getEntriesByType === 'function'
        ? performance.getEntriesByType('navigation')
        : []
    const paint =
      typeof performance.getEntriesByName === 'function'
        ? performance.getEntriesByName('first-contentful-paint')[0]?.startTime
        : undefined
    const value = readDocumentMetrics(entries[0] as PerformanceNavigationTiming | undefined, paint)
    if (value.status !== 'measuring') this.finish(value)
  }

  private onLoad = () => {
    // load 回调内 loadEventEnd 仍为 0，下一任务再读取。
    this.loadTimer = window.setTimeout(() => this.complete(), 0)
  }
  private onVisibility = () => {
    if (document.hidden) this.onHidden()
  }
  private onHidden = () => {
    if (this.snapshot.status === 'measuring')
      this.finish({ kind: this.snapshot.kind, status: 'interrupted' })
  }
  private finish(value: LoadMetrics) {
    this.stop()
    this.publish(value)
  }
  private cancelFrames() {
    window.cancelAnimationFrame(this.firstFrame)
    window.cancelAnimationFrame(this.secondFrame)
  }
  private stop() {
    this.cancelFrames()
    window.clearTimeout(this.timer)
    window.clearTimeout(this.loadTimer)
    window.removeEventListener('load', this.onLoad)
    window.removeEventListener('pagehide', this.onHidden)
    document.removeEventListener('visibilitychange', this.onVisibility)
  }
  dispose() {
    this.stop()
    this.route = ''
    this.listeners.clear()
  }
}

/** React Router 可能以 transition 延后渲染，导航起点需在 history 更新时捕获。 */
export function observePageNavigations(tracker: PageLoadTracker): () => void {
  const originalPush = window.history.pushState
  const originalReplace = window.history.replaceState
  let previous = window.location.pathname + window.location.search
  const navigate = () => {
    const next = window.location.pathname + window.location.search
    if (next === previous) return
    previous = next
    tracker.start(next, false)
  }
  const push: History['pushState'] = function (this: History, ...args) {
    originalPush.apply(this, args)
    navigate()
  }
  const replace: History['replaceState'] = function (this: History, ...args) {
    originalReplace.apply(this, args)
    navigate()
  }
  window.history.pushState = push
  window.history.replaceState = replace
  window.addEventListener('popstate', navigate)
  return () => {
    if (window.history.pushState === push) window.history.pushState = originalPush
    if (window.history.replaceState === replace) window.history.replaceState = originalReplace
    window.removeEventListener('popstate', navigate)
  }
}
