export interface User {
  id: string
  username: string
  email: string | null
  role?: 'user' | 'admin'
  created_at?: string
}

export interface LoginRequest {
  username: string
  password: string
  remember_me?: boolean
}

export interface LoginResponse {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  user: User
}

export interface RegisterRequest {
  username: string
  password: string
  email?: string
}

export interface RegisterResponse {
  user: User
}

export interface RefreshTokenRequest {
  refresh_token: string
}

export interface RefreshTokenResponse {
  access_token: string
  // 刷新令牌每次刷新都会轮换，必须同步保存新的值
  refresh_token: string
  token_type: string
  expires_in: number
  // Go 后端刷新接口不返回用户信息，此时保留当前已登录用户
  user?: User
}
