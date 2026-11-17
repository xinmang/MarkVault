import type { ApiResponse } from './types'
import { useAuthStore } from '@/stores/authStore'
import { logger } from '@/lib/logger'
import {
  AuthSessionChangedError,
  isSameAuthGeneration,
  snapshotAuthSession,
  type AuthSessionSnapshot,
} from '@/lib/auth-session'

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api/v1'

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * 认证接口自身的 401 不能触发刷新流程，否则会形成刷新循环。
 */
const AUTH_ENDPOINTS_WITHOUT_REFRESH = [
  '/auth/login',
  '/auth/register',
  '/auth/refresh',
  '/auth/logout',
  '/auth/passkey/login',
  '/auth/passkey/register/finish',
]

function shouldSkipRefresh(endpoint: string): boolean {
  const path = endpoint.split('?')[0] ?? ''
  return AUTH_ENDPOINTS_WITHOUT_REFRESH.some((item) => path === item || path.startsWith(`${item}/`))
}

/**
 * HTTP 客户端
 */
class HttpClient {
  private baseURL: string

  constructor(baseURL: string) {
    this.baseURL = baseURL
  }

  private getAuthToken(): string | null {
    return useAuthStore.getState().accessToken
  }

  /**
   * 处理 401：同一会话只共享一次刷新，并用刷新后的最新令牌重试。
   *
   * - 迟到的旧 401：如果同一会话已拿到新访问令牌，直接用它重试，不再消耗刷新令牌
   * - 账号或会话代次已变：不刷新、不清状态，原样返回 401，避免用新会话凭据重放旧请求
   */
  private async retryAfterUnauthorized(
    response: Response,
    initialSession: AuthSessionSnapshot,
    usedToken: string,
    makeRequest: (authToken: string | null) => Promise<Response>
  ): Promise<Response> {
    const latest = snapshotAuthSession(useAuthStore.getState())

    // 旧会话（含同账号重新登录）的请求不能切换到新凭据下重试
    if (!isSameAuthGeneration(initialSession, latest)) {
      return response
    }

    // 其他请求已经完成刷新：直接复用新令牌重试一次
    if (latest.accessToken && latest.accessToken !== usedToken) {
      return makeRequest(latest.accessToken)
    }

    if (!latest.refreshToken) {
      return response
    }

    try {
      await useAuthStore.getState().refreshAccessToken()
    } catch (error) {
      // 会话已变更：旧请求无权清理或跳转
      if (error instanceof AuthSessionChangedError) {
        return response
      }
      // 状态清理由 authStore 按会话归属决定，这里只在确实已无认证会话时跳转登录；
      // 刷新失败的原始错误向上抛出，不伪装成普通 401
      logger.error('Token refresh failed:', error)
      this.redirectToLoginIfSignedOut()
      throw error
    }

    // 刷新完成后必须重新读取 store，不能用 await 之前的旧快照
    const refreshed = snapshotAuthSession(useAuthStore.getState())
    if (!isSameAuthGeneration(initialSession, refreshed) || !refreshed.accessToken) {
      return response
    }
    return makeRequest(refreshed.accessToken)
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    const url = `${this.baseURL}${endpoint}`
    const skipRefresh = shouldSkipRefresh(endpoint)
    // 请求发起时的会话快照，用于判断刷新结果和重试是否仍属于同一会话
    const initialSession = snapshotAuthSession(useAuthStore.getState())
    const token = this.getAuthToken()

    const makeRequest = async (authToken: string | null) => {
      const headers = new Headers({
        'Content-Type': 'application/json',
        ...(options.headers && typeof options.headers === 'object' ? options.headers : {}),
      })

      if (authToken && !headers.get('Authorization')) {
        headers.set('Authorization', `Bearer ${authToken}`)
      }

      return fetch(url, {
        ...options,
        headers,
      })
    }

    try {
      let response = await makeRequest(token)

      // 只有携带了访问令牌的请求才可能因令牌过期而 401
      if (response.status === 401 && !skipRefresh && token) {
        response = await this.retryAfterUnauthorized(response, initialSession, token, makeRequest)
      }

      if (response.status === 204) {
        return {} as ApiResponse<T>
      }

      let data: unknown
      try {
        const text = await response.text()
        if (!text || text.trim() === '') {
          if (!response.ok) {
            throw new ApiError('EMPTY_RESPONSE', 'Server returned empty response', response.status)
          }
          return {} as ApiResponse<T>
        }
        data = JSON.parse(text) as unknown
      } catch (parseError) {
        if (parseError instanceof ApiError) {
          throw parseError
        }
        throw new ApiError(
          'INVALID_RESPONSE',
          `Failed to parse server response: ${parseError instanceof Error ? parseError.message : 'Invalid JSON'}`,
          response.status
        )
      }

      if (!response.ok) {
        const errorData = data as { error?: { code: string; message: string } }
        const error = errorData.error || { code: 'UNKNOWN_ERROR', message: 'An error occurred' }
        throw new ApiError(error.code, error.message, response.status)
      }

      return data as ApiResponse<T>
    } catch (error) {
      if (error instanceof ApiError) {
        throw error
      }

      throw new ApiError(
        'NETWORK_ERROR',
        error instanceof Error ? error.message : 'Network request failed',
        0
      )
    }
  }

  /** 仅在当前确实没有认证会话时跳转登录页。 */
  private redirectToLoginIfSignedOut() {
    const { isAuthenticated, accessToken } = useAuthStore.getState()
    if (isAuthenticated || accessToken) return

    if (!window.location.pathname.includes('/login')) {
      window.location.href = '/login'
    }
  }

  async get<T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'GET' })
  }

  async post<T>(endpoint: string, body?: unknown, options?: RequestInit): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  async put<T>(endpoint: string, body?: unknown, options?: RequestInit): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  async patch<T>(endpoint: string, body?: unknown, options?: RequestInit): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  async delete<T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' })
  }
}

export const apiClient = new HttpClient(API_BASE_URL)
