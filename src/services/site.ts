import { apiClient } from '@/lib/api-client'
import type {
  SiteBranding,
  SiteBrandingResponse,
  SiteSettingsResponse,
  UpdateSiteSettingsRequest,
} from '@/lib/types'
import { assertData } from './index'

export const siteService = {
  /** 匿名读取公开品牌信息，登录页与分享页也使用这个接口 */
  async getPublicSite(): Promise<SiteBranding> {
    const response = await apiClient.get<SiteBrandingResponse>('/site')
    return assertData(response.data, 'GET /site').site
  },

  /** 登录后读取品牌信息与当前账号是否可编辑 */
  async getSettings(): Promise<SiteSettingsResponse> {
    const response = await apiClient.get<SiteSettingsResponse>('/settings/site')
    return assertData(response.data, 'GET /settings/site')
  },

  /** 保存品牌设置或恢复默认值，服务端会再次校验管理员身份 */
  async updateSettings(payload: UpdateSiteSettingsRequest): Promise<SiteSettingsResponse> {
    const response = await apiClient.put<SiteSettingsResponse>('/settings/site', payload)
    return assertData(response.data, 'PUT /settings/site')
  },
}
