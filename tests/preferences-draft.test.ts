import { describe, expect, it } from 'vitest'
import { mergePreferencesDraft } from '../src/lib/preferences-draft'
import type { UserPreferences } from '../src/lib/types'

const original = {
  user_id: 'owner',
  motion_enabled: true,
  ocean_background_scope: 'browser',
  ocean_background: 'off',
  page_size: 30,
} as UserPreferences
const keys = ['motion_enabled', 'ocean_background_scope', 'ocean_background', 'page_size'] as const

describe('设置草稿与后台同步', () => {
  it('保留尚未保存的动效开关，同时接收其他浏览器更新的海洋样式', () => {
    const draft = { ...original, motion_enabled: false }
    const incoming = {
      ...original,
      ocean_background_scope: 'account',
      ocean_background: 'mixed',
      page_size: 50,
    } as UserPreferences
    expect(mergePreferencesDraft(original, draft, incoming, keys)).toEqual({
      ...incoming,
      motion_enabled: false,
    })
  })

  it('保存成功后草稿与服务器一致，不遗留虚假的未保存状态', () => {
    const draft = { ...original, ocean_background: 'sharks' } as UserPreferences
    const incoming = { ...draft, updated_at: '2026-11-03T05:00:00.000Z' }
    expect(mergePreferencesDraft(original, draft, incoming, keys)).toEqual(incoming)
  })

  it('初次加载与切换账号时使用新账号设置', () => {
    const other = { ...original, user_id: 'other' }
    expect(mergePreferencesDraft(null, null, other, keys)).toBe(other)
    expect(
      mergePreferencesDraft(original, { ...original, motion_enabled: false }, other, keys)
    ).toBe(other)
  })
})
