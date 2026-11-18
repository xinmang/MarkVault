import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, useLocation } from 'react-router-dom'
import { useEffect, useRef, type ReactNode } from 'react'
import { AppRouter } from '@/routes'
import { useAuthStore } from '@/stores/authStore'
import { ToastContainer } from '@/components/common/Toast'
import { DialogHost } from '@/components/common/DialogHost'
import { NotesDialogHost } from '@/components/notes/NotesDialog'
import { useToastStore } from '@/stores/toastStore'
import { queryClient } from '@/lib/query-client'
import { logger } from '@/lib/logger'
import { AuthSessionChangedError } from '@/lib/auth-session'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { usePreferences } from '@/hooks/usePreferences'
import { ExperimentalFeaturesProvider } from '@/contexts/ExperimentalFeaturesContext'
import { SiteBrandingProvider } from '@/contexts/SiteBrandingContext'
import { PluginProvider } from '@/plugins/PluginProvider'
import { PageSpeedProvider } from '../plugins/builtin/page-speed/PageSpeedProvider'

function ExperimentalAppExperience({ children }: { children: ReactNode }) {
  const location = useLocation()
  const { isAuthenticated } = useAuthStore()
  const useAccountPreferences = isAuthenticated && !location.pathname.startsWith('/share/')
  const { data: preferences } = usePreferences({ enabled: useAccountPreferences })

  if (!useAccountPreferences) return children

  return (
    <ExperimentalFeaturesProvider preferences={preferences} applyThemeToDocument>
      {children}
    </ExperimentalFeaturesProvider>
  )
}

function App() {
  const { user, isAuthenticated, accessToken, refreshToken, clearAuth, refreshAccessToken } =
    useAuthStore()
  const { toasts, removeToast } = useToastStore()
  const previousUserId = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    if (!isAuthenticated || accessToken) return

    if (!refreshToken) {
      // 标记为已登录却没有可刷新令牌，属于无效会话
      clearAuth()
      return
    }

    refreshAccessToken().catch((error: unknown) => {
      // 会话已变更或已被判定失效时静默；其余（网络、5xx、429）只记录简要信息，
      // 是否清理状态由 authStore 按会话归属决定
      if (error instanceof AuthSessionChangedError) return
      const status = (error as { status?: number } | null)?.status
      if (status === 401 || status === 403) return
      logger.warn(
        '刷新访问令牌失败，稍后可重试：',
        status ?? (error instanceof Error ? error.name : 'unknown')
      )
    })
  }, [isAuthenticated, accessToken, refreshToken, refreshAccessToken, clearAuth])

  const userId = user?.id ?? null

  useEffect(() => {
    if (previousUserId.current === undefined) {
      previousUserId.current = userId
      return
    }

    if (previousUserId.current !== userId) {
      queryClient.clear()
      previousUserId.current = userId
    }
  }, [userId])

  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout>
    const handler = () => {
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        queryClient
          .invalidateQueries({ queryKey: ['bookmarks'] })
          .catch((err) => console.error('Failed to invalidate bookmarks:', err))
        queryClient
          .invalidateQueries({ queryKey: ['tags'] })
          .catch((err) => console.error('Failed to invalidate tags:', err))
      }, 300)
    }

    window.addEventListener('markvault:data-changed', handler)
    return () => {
      window.removeEventListener('markvault:data-changed', handler)
      clearTimeout(debounceTimer)
    }
  }, [])

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <SiteBrandingProvider>
          <BrowserRouter>
            <PluginProvider>
              <ExperimentalAppExperience>
                <PageSpeedProvider>
                  <AppRouter />
                </PageSpeedProvider>
                <ToastContainer toasts={toasts} onClose={removeToast} />
                <DialogHost />
                <NotesDialogHost />
              </ExperimentalAppExperience>
            </PluginProvider>
          </BrowserRouter>
        </SiteBrandingProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}

export default App
