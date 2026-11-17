import {
  OCEAN_BACKGROUND_MODES,
  type OceanBackgroundMode,
  type OceanBackgroundScope,
  type OceanPreferences,
} from '@shared/ocean-preferences'
export * from '@shared/ocean-preferences'

/** 兼容缺少字段的旧主题缓存，未知值回到关闭状态。 */
export function resolveOceanBackground(value: unknown): OceanBackgroundMode {
  return OCEAN_BACKGROUND_MODES.find((mode) => mode === value) ?? 'off'
}

export function resolveOceanBackgroundScope(value: unknown): OceanBackgroundScope {
  return value === 'account' ? 'account' : 'browser'
}

/** 不在两种模式之间复制选择，切换回来时仍保留各自原来的样式。 */
export function effectiveOceanBackground(
  preferences: Partial<OceanPreferences> | null | undefined,
  browserValue: unknown
): OceanBackgroundMode {
  return resolveOceanBackground(
    resolveOceanBackgroundScope(preferences?.ocean_background_scope) === 'account'
      ? preferences?.ocean_background
      : browserValue
  )
}
