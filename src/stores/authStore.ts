import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { User, LoginResponse } from '@/lib/types'
import { authService } from '@/services/auth'
import { logger } from '@/lib/logger'
import {
  AuthSessionChangedError,
  isSameAuthSession,
  snapshotAuthSession,
  type AuthSessionSnapshot,
} from '@/lib/auth-session'

interface AuthState {
  user: User | null
  accessToken: string | null
  refreshToken: string | null
  isAuthenticated: boolean
  isLoading: boolean
  /** 会话代次：登录成功、登出/清理时递增，正常刷新令牌轮换保持不变 */
  sessionVersion: number

  // Actions
  login: (username: string, password: string, rememberMe?: boolean) => Promise<void>
  register: (username: string, password: string, email?: string) => Promise<void>
  logout: (revokeAll?: boolean) => Promise<void>
  refreshAccessToken: () => Promise<void>
  setUser: (user: User) => void
  acceptPasskeyLogin: (data: LoginResponse) => void
  clearAuth: () => void
}

/** 刷新接口明确表示会话失效的状态码；其他错误（网络、5xx、429）不代表会话失效。 */
function isSessionInvalidError(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status
  return status === 401 || status === 403
}

/**
 * 与某个刷新令牌对应的进行中刷新任务。
 *
 * 刷新令牌每次轮换都会被消费，因此同一会话的并发 401（包括 App 里的主动刷新）
 * 必须共享同一个请求，否则后到的请求会拿着已被消费的令牌刷新失败。
 */
let inFlightRefresh: (AuthSessionSnapshot & { promise: Promise<void> }) | null = null

/** 撤销已结束会话凭据的后台请求超时，避免旧刷新任务长期悬挂。 */
const ORPHAN_REVOKE_TIMEOUT_MS = 8000

/**
 * 在后台撤销已结束会话（登出、切换账号）迟到的刷新凭据。
 *
 * 不阻塞旧刷新请求结束，也始终使用该次刷新返回的凭据，因此不会影响当前登录账号；
 * 撤销失败只记录日志，不改变任何认证状态。
 */
function revokeOrphanedSession(refreshToken: string, accessToken?: string): void {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ORPHAN_REVOKE_TIMEOUT_MS)

  void authService
    .logout(refreshToken, false, accessToken, { signal: controller.signal })
    .catch((error: unknown) => {
      logger.warn('撤销已结束会话的刷新凭据失败：', (error as { status?: number } | null)?.status)
    })
    .finally(() => clearTimeout(timer))
}

/**
 * 执行一次真实的刷新请求。
 *
 * 成功与失败都要先核对会话归属：登出或切换账号后，旧请求无权写入新状态，
 * 也无权清理新账号。
 */
function performRefresh(session: AuthSessionSnapshot): Promise<void> {
  const { refreshToken } = session
  if (!refreshToken) return Promise.reject(new Error('No refresh token available'))

  return authService.refreshToken({ refresh_token: refreshToken }).then(
    (data) => {
      // 刷新期间已登出、切换账号或重新登录：丢弃结果，不改动任何状态
      if (!isSameAuthSession(session, snapshotAuthSession(useAuthStore.getState()))) {
        // 退出或切换账号后到达的刷新结果也必须在服务端撤销，避免留下有效的孤立会话。
        // 撤销放在后台执行，旧请求不必等待另一次网络请求。
        revokeOrphanedSession(data.refresh_token, data.access_token)
        throw new AuthSessionChangedError()
      }

      useAuthStore.setState((state) => ({
        // Go 刷新接口不返回 user，此时保留当前用户，绝不能写成 undefined
        user: data.user ?? state.user,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        isAuthenticated: true,
      }))
    },
    (error: unknown) => {
      // 只有发起刷新时的会话仍然有效，才允许影响当前认证状态
      if (!isSameAuthSession(session, snapshotAuthSession(useAuthStore.getState()))) {
        throw new AuthSessionChangedError()
      }

      // 临时故障保留令牌以便恢复后重试；仅明确的会话失效才清理
      if (isSessionInvalidError(error)) {
        useAuthStore.getState().clearAuth()
      }
      throw error
    }
  )
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,
      sessionVersion: 0,

      login: async (username: string, password: string, rememberMe = false) => {
        set({ isLoading: true })
        try {
          const data = await authService.login({ username, password, remember_me: rememberMe })

          // 新登录进入新的会话代次，旧刷新任务不再有写入权
          inFlightRefresh = null
          set((state) => ({
            user: data.user,
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            isAuthenticated: true,
            isLoading: false,
            sessionVersion: state.sessionVersion + 1,
          }))
        } catch (error) {
          set({ isLoading: false })
          throw error
        }
      },

      register: async (username: string, password: string, email?: string) => {
        set({ isLoading: true })
        try {
          await authService.register({ username, password, email })
          set({ isLoading: false })
          // 注册成功后不自动登录，让用户手动登录
        } catch (error) {
          set({ isLoading: false })
          throw error
        }
      },

      logout: async (revokeAll = false) => {
        const { refreshToken, accessToken } = get()

        // 先用发起时的凭据启动退出请求，再立即让本地会话失效，
        // 这样退出期间返回的刷新结果无法恢复认证状态。
        const request = refreshToken
          ? authService.logout(refreshToken, revokeAll, accessToken).catch((error: unknown) => {
              // 令牌已失效属正常退出；其他错误仅记录，不影响已经完成的本地退出
              if (!isSessionInvalidError(error)) {
                logger.error('Logout error:', error)
              }
            })
          : Promise.resolve()

        get().clearAuth()
        await request
      },

      refreshAccessToken: async () => {
        const session = snapshotAuthSession(get())
        if (!session.refreshToken) {
          throw new Error('No refresh token available')
        }

        // 同一会话共享一次刷新，避免轮换后的刷新令牌被重复消费
        if (inFlightRefresh && isSameAuthSession(inFlightRefresh, session)) {
          return inFlightRefresh.promise
        }

        const entry = { ...session, promise: performRefresh(session) }
        inFlightRefresh = entry

        try {
          await entry.promise
        } finally {
          if (inFlightRefresh === entry) {
            inFlightRefresh = null
          }
        }
      },

      acceptPasskeyLogin: (data) => {
        inFlightRefresh = null
        set((state) => ({
          user: data.user,
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          isAuthenticated: true,
          isLoading: false,
          sessionVersion: state.sessionVersion + 1,
        }))
      },
      setUser: (user: User) => {
        set({ user })
      },

      clearAuth: () => {
        // 进入新的会话代次后，所有进行中的刷新都会因会话变更而丢弃结果
        inFlightRefresh = null
        set((state) => ({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
          isLoading: false,
          sessionVersion: state.sessionVersion + 1,
        }))
      },
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => localStorage),
      // sessionVersion 只用于运行时判断，不需要持久化
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
)
