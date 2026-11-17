import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { useUpdatePreferences, selectLatestStoredPreferences } from '../src/hooks/usePreferences'
import type { UserPreferences } from '../src/lib/types'

const mocks = vi.hoisted(() => ({ update: vi.fn(), uid: 'owner' }))
vi.mock('@/services/preferences', () => ({
  preferencesService: { updatePreferences: mocks.update },
}))
vi.mock('@/stores/authStore', () => ({
  useAuthStore: { getState: () => ({ user: { id: mocks.uid } }) },
}))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }))

const initial = {
  user_id: 'owner',
  ocean_background_scope: 'browser',
  ocean_background: 'off',
  updated_at: '2026-11-03T01:00:00.000Z',
} as UserPreferences
let storage: Map<string, string>
beforeEach(() => {
  mocks.uid = 'owner'
  mocks.update.mockReset()
  storage = new Map([['markvault:preferences', JSON.stringify(initial)]])
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  })
})
afterEach(() => vi.unstubAllGlobals())

function renderUpdate() {
  const client = new QueryClient()
  client.setQueryData(['preferences'], initial)
  let update!: ReturnType<typeof useUpdatePreferences>
  function Probe() {
    update = useUpdatePreferences({ requireServer: true })
    return null
  }
  renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  )
  return { client, save: update.mutateAsync }
}

describe('海洋账号设置同步', () => {
  it('服务器确认后才更新本地偏好和缓存', async () => {
    let complete!: (value: UserPreferences) => void
    mocks.update.mockReturnValue(
      new Promise<UserPreferences>((resolve) => {
        complete = resolve
      })
    )
    const { client, save } = renderUpdate()
    const pending = save({ ocean_background_scope: 'account', ocean_background: 'sharks' })
    await vi.waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1))
    expect(client.getQueryData(['preferences'])).toEqual(initial)
    expect(JSON.parse(storage.get('markvault:preferences')!)).toEqual(initial)
    const saved = {
      ...initial,
      ocean_background_scope: 'account',
      ocean_background: 'sharks',
      updated_at: '2026-11-03T02:00:00.000Z',
    } as UserPreferences
    complete(saved)
    await pending
    expect(client.getQueryData(['preferences'])).toEqual(saved)
    expect(JSON.parse(storage.get('markvault:preferences')!)).toEqual(saved)
    client.clear()
  })

  it('同步失败向设置页报告错误，不能伪装成保存成功', async () => {
    mocks.update.mockRejectedValue(new Error('服务器不可用'))
    const { client, save } = renderUpdate()
    await expect(save({ ocean_background_scope: 'account' })).rejects.toThrow('服务器不可用')
    expect(client.getQueryData(['preferences'])).toEqual(initial)
    expect(JSON.parse(storage.get('markvault:preferences')!)).toEqual(initial)
    client.clear()
  })

  it('切换账号时不继承前一个账号的海洋选择', () => {
    mocks.uid = 'another-owner'
    storage.set(
      'markvault:preferences',
      JSON.stringify({ ...initial, ocean_background_scope: 'account', ocean_background: 'mixed' })
    )
    const selected = selectLatestStoredPreferences({
      ...initial,
      ocean_background_scope: 'account',
      ocean_background: 'sharks',
    })
    expect(selected.ocean_background_scope).toBe('browser')
    expect(selected.ocean_background).toBe('off')
  })
})
