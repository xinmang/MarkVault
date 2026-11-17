import { useCallback, useState } from 'react'
import type { ChartStyle } from '../utils/view'

const STORAGE_KEY = 'markvault:statistics:chart-style'

function readStoredStyle(): ChartStyle {
  if (typeof window === 'undefined') return 'bar'
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    // 只接受已知取值，其它（旧版本、被手动改坏）一律回退到默认柱状
    return stored === 'line' ? 'line' : 'bar'
  } catch {
    return 'bar'
  }
}

/**
 * 图表样式偏好（柱状 / 折线），持久化在 localStorage。
 * 读写都做了防御，隐私模式或存储被禁用时退化为内存状态。
 */
export function useChartStyle() {
  const [style, setStyleState] = useState<ChartStyle>(readStoredStyle)

  const setStyle = useCallback((next: ChartStyle) => {
    setStyleState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // 存储不可用时只保留当前会话内的选择
    }
  }, [])

  return { style, setStyle }
}
