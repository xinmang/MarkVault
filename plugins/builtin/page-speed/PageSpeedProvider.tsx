import { useContext, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useBuiltinPluginRunning } from '@/plugins/context'
import { PageLoadTracker, observePageNavigations } from './metrics'
import { PageSpeedContext } from './context'

/** 放在 Suspense 外，才能把懒加载页面模块的等待时间计算在内。 */
export function PageSpeedProvider({ children }: { children: ReactNode }) {
  const enabled = useBuiltinPluginRunning('page-speed')
  const { pathname, search } = useLocation()
  const route = pathname + search
  const initialRoute = useRef(route)
  const navigated = useRef(false)
  const tracker = useMemo(() => (enabled ? new PageLoadTracker() : null), [enabled])
  const previousTracker = useRef<PageLoadTracker | null>(null)
  useLayoutEffect(() => {
    if (route !== initialRoute.current) navigated.current = true
    // 导航结束后才启用时无法追溯起点，等待下次切页，不展示虚假的极短耗时。
    if (tracker && tracker !== previousTracker.current && navigated.current)
      tracker.waitForNavigation()
    else tracker?.start(route, !navigated.current)
    previousTracker.current = tracker
  }, [tracker, route])
  useLayoutEffect(() => {
    if (!tracker) return
    const stop = observePageNavigations(tracker)
    return () => {
      stop()
      tracker.dispose()
    }
  }, [tracker])
  return <PageSpeedContext.Provider value={tracker}>{children}</PageSpeedContext.Provider>
}

/** 放在 Suspense 内，内容提交后才通知测量器；快速切页会取消旧任务。 */
export function PageSpeedCommit() {
  const tracker = useContext(PageSpeedContext)
  const { pathname, search } = useLocation()
  useLayoutEffect(() => {
    if (!tracker) return
    const timer = window.setTimeout(() => tracker?.committed(pathname + search), 0)
    return () => window.clearTimeout(timer)
  }, [tracker, pathname, search])
  return null
}
