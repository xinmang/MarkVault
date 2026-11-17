import { afterEach, describe, expect, it, vi } from 'vitest'
import { selectLatestStoredPreferences } from '../src/hooks/usePreferences'
import type { UserPreferences } from '../src/lib/types'

afterEach(() => vi.unstubAllGlobals())

function store(preferences: Partial<UserPreferences> | null) {
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) =>
        key === 'markvault:preferences' && preferences ? JSON.stringify(preferences) : null,
    },
  })
}

describe('设置保存后立即刷新', () => {
  it('较新的本地设置优先于尚未写完的旧查询缓存', () => {
    store({
      page_size: 50,
      bookmark_initial_count: 20,
      bookmark_load_more_expiry_minutes: 0,
      updated_at: '2026-10-21T13:25:43.606Z',
    })
    const restored = selectLatestStoredPreferences({
      page_size: 30,
      bookmark_initial_count: 30,
      bookmark_load_more_expiry_minutes: 5,
      updated_at: '2026-10-21 13:22:05',
    } as UserPreferences)
    expect(restored).toMatchObject({
      page_size: 50,
      bookmark_initial_count: 20,
      bookmark_load_more_expiry_minutes: 0,
    })
  })

  it('服务器或缓存较新时采用较新值', () => {
    store({ page_size: 50, updated_at: '2026-10-21T13:22:05.000Z' })
    const restored = selectLatestStoredPreferences({
      page_size: 100,
      updated_at: '2026-10-21T13:25:43.606Z',
    } as UserPreferences)
    expect(restored.page_size).toBe(100)
  })

  it('旧版本缺少新增字段时补齐默认值', () => {
    store(null)
    const restored = selectLatestStoredPreferences({
      page_size: 50,
      updated_at: '2026-10-21T13:25:43.606Z',
    } as UserPreferences)
    expect(restored).toMatchObject({
      page_size: 50,
      bookmark_initial_count: 30,
      bookmark_load_more_expiry_minutes: 5,
    })
  })
})
