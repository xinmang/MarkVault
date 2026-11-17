import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { assertData } from '@/services'

export interface AuthOptions {
  registration_enabled: boolean
  passkey_enabled: boolean
}

/** 登录页定时刷新公开入口；接口异常时不显示注册和通行密钥入口。 */
export function useAuthOptions() {
  return useQuery({
    queryKey: ['auth-options'],
    queryFn: async () =>
      assertData((await apiClient.get<AuthOptions>('/auth/options')).data, 'GET /auth/options'),
    staleTime: 0,
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  })
}
