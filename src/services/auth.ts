import { apiClient, ApiError } from '@/lib/api-client'
import type {
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  RegisterResponse,
  RefreshTokenRequest,
  RefreshTokenResponse,
} from '@/lib/types'
import { assertData } from './index'

export const authService = {
  /**
   * 用户注册
   */
  async register(data: RegisterRequest) {
    const response = await apiClient.post<RegisterResponse>('/auth/register', data)
    return assertData(response.data, 'POST /auth/register')
  },

  /**
   * 用户登录
   */
  async login(data: LoginRequest) {
    const response = await apiClient.post<LoginResponse>('/auth/login', data)
    return assertData(response.data, 'POST /auth/login')
  },

  /**
   * 刷新访问令牌
   */
  async refreshToken(data: RefreshTokenRequest) {
    const response = await apiClient.post<RefreshTokenResponse>('/auth/refresh', data)
    return assertData(response.data, 'POST /auth/refresh')
  },

  /**
   * 登出
   */
  async logout(
    refreshToken: string,
    revokeAll = false,
    accessToken?: string | null,
    options?: { signal?: AbortSignal }
  ) {
    const signal = options?.signal
    const revoke = (refresh: string, access?: string | null) => apiClient.post('/auth/logout', {
      refresh_token: refresh,
      revoke_all: revokeAll,
    }, {
      ...(signal ? { signal } : {}),
      ...(access ? { headers: { Authorization: `Bearer ${access}` } } : {}),
    })

    try {
      await revoke(refreshToken, accessToken)
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error

      // 访问令牌过期不代表刷新令牌已撤销；仅为退出换取凭据，不写回登录状态。
      const response = await apiClient.post<RefreshTokenResponse>('/auth/refresh', {
        refresh_token: refreshToken,
      }, signal ? { signal } : undefined)
      const renewed = assertData(response.data, 'POST /auth/refresh')
      await revoke(renewed.refresh_token, renewed.access_token)
    }
  },
}
