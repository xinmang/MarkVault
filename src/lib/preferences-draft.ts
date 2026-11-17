import type { UserPreferences } from './types'

/** 后台同步时保留正在编辑的字段，其余字段采用服务器新值。 */
export function mergePreferencesDraft(
  previous: UserPreferences | null,
  draft: UserPreferences | null,
  incoming: UserPreferences,
  editableKeys: readonly (keyof UserPreferences)[]
): UserPreferences {
  if (!previous || !draft || previous.user_id !== incoming.user_id) return incoming
  const edits = Object.fromEntries(
    editableKeys.filter((key) => draft[key] !== previous[key]).map((key) => [key, draft[key]])
  )
  return { ...incoming, ...edits }
}
