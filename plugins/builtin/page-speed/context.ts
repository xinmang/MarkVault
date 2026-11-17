import { createContext } from 'react'
import type { PageLoadTracker } from './metrics'

export const PageSpeedContext = createContext<PageLoadTracker | null>(null)
