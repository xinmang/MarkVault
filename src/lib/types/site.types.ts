/** 全站站点品牌设置：全局单例，不随账号偏好保存到浏览器存储。 */
export interface SiteBranding {
  site_name: string
  site_description: string
  site_logo: string
  site_favicon: string
  updated_at?: string | null
}

/** 匿名接口 GET /api/v1/site 的响应 */
export interface SiteBrandingResponse {
  site: SiteBranding
}

/** 品牌设置的默认值，服务端返回，前端不另行维护一份硬编码默认值 */
export type SiteBrandingDefaults = Omit<SiteBranding, 'updated_at'>

/** 登录后 GET /api/v1/settings/site 的响应，can_edit 由服务端按管理员身份计算 */
export interface SiteSettingsResponse {
  site: SiteBranding
  can_edit: boolean
  defaults: SiteBrandingDefaults
}

export interface UpdateSiteSettingsRequest {
  site_name?: string
  site_description?: string
  site_logo?: string
  site_favicon?: string
  /** 显式恢复默认值，与服务端字段同名校验 */
  reset_defaults?: true
}
