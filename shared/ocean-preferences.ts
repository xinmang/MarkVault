export const OCEAN_BACKGROUND_MODES = ['off', 'sharks', 'dolphins', 'mixed'] as const
export type OceanBackgroundMode = (typeof OCEAN_BACKGROUND_MODES)[number]

export const OCEAN_BACKGROUND_SCOPES = ['browser', 'account'] as const
export type OceanBackgroundScope = (typeof OCEAN_BACKGROUND_SCOPES)[number]

/** 账号选择保存到服务端；浏览器选择独立保留在主题缓存中。 */
export interface OceanPreferences {
  ocean_background_scope: OceanBackgroundScope
  ocean_background: OceanBackgroundMode
}

export const DEFAULT_OCEAN_PREFERENCES: OceanPreferences = {
  ocean_background_scope: 'browser',
  ocean_background: 'off',
}
