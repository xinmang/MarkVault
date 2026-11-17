import { afterEach, beforeEach, expect, it, vi } from 'vitest'

let useAuthStore: typeof import('../src/stores/authStore')['useAuthStore']
let apiClient: typeof import('../src/lib/api-client')['apiClient']
const user = { id: 'test-user', username: '测试账号', email: null }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
const unauthorized = () => json({ error: { code: 'UNAUTHORIZED', message: '登录已过期' } }, 401)

beforeEach(async () => {
  vi.resetModules()
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('window', { localStorage: storage, location: { pathname: '/login', href: '/login' } })
  ;({ useAuthStore } = await import('../src/stores/authStore'))
  ;({ apiClient } = await import('../src/lib/api-client'))
  useAuthStore.setState({ user, accessToken: 'access-0', refreshToken: 'refresh-0', isAuthenticated: true })
})

afterEach(() => { vi.unstubAllGlobals() })

it('连续刷新保存轮换凭据，并保留 Go 刷新接口未返回的用户信息', async () => {
  let round = 0
  const fetch = vi.fn(async (_url: string, options: RequestInit) => {
    expect(JSON.parse(String(options.body)).refresh_token).toBe(`refresh-${round}`)
    round++
    return json({ data: { access_token: `access-${round}`, refresh_token: `refresh-${round}`, token_type: 'Bearer', expires_in: 900 } })
  })
  vi.stubGlobal('fetch', fetch)
  for (let i = 1; i <= 2; i++) {
    await useAuthStore.getState().refreshAccessToken()
    expect(useAuthStore.getState()).toMatchObject({ user, accessToken: `access-${i}`, refreshToken: `refresh-${i}`, isAuthenticated: true })
  }
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('并发请求只刷新一次，并使用新的访问令牌重试', async () => {
  let finishRefresh!: (response: Response) => void
  const refreshed = new Promise<Response>((resolve) => { finishRefresh = resolve })
  let refreshCount = 0
  const fetch = vi.fn(async (url: string, options: RequestInit) => {
    if (url.endsWith('/auth/refresh')) { refreshCount++; return refreshed }
    return new Headers(options.headers).get('Authorization') === 'Bearer access-1'
      ? json({ data: { ok: true } })
      : unauthorized()
  })
  vi.stubGlobal('fetch', fetch)
  const pending = Promise.all([apiClient.get('/me'), apiClient.get('/bookmarks')])
  await vi.waitFor(() => expect(refreshCount).toBe(1))
  finishRefresh(json({ data: { access_token: 'access-1', refresh_token: 'refresh-1', token_type: 'Bearer', expires_in: 900 } }))
  await expect(pending).resolves.toEqual([{ data: { ok: true } }, { data: { ok: true } }])
  expect(refreshCount).toBe(1)
  expect(fetch).toHaveBeenCalledTimes(5)
})

it('退出后返回的刷新结果不能恢复旧会话', async () => {
  let finishRefresh!: (response: Response) => void
  const cleanupRequests: Array<{ body: unknown; authorization: string | null }> = []
  const fetch = vi.fn((url: string, options: RequestInit) => {
    if (url.endsWith('/auth/refresh')) return new Promise<Response>((resolve) => { finishRefresh = resolve })
    // 会话结束后的清理登出请求及时返回，不阻塞旧刷新请求
    cleanupRequests.push({
      body: JSON.parse(String(options.body)),
      authorization: new Headers(options.headers).get('Authorization'),
    })
    return Promise.resolve(json({ data: { ok: true } }))
  })
  vi.stubGlobal('fetch', fetch)
  const pending = useAuthStore.getState().refreshAccessToken().catch(() => undefined)
  useAuthStore.getState().clearAuth()
  finishRefresh(json({ data: { access_token: 'access-1', refresh_token: 'refresh-1', token_type: 'Bearer', expires_in: 900 } }))
  await pending
  expect(useAuthStore.getState()).toMatchObject({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false })
  // 迟到结果必须在后台用本次刷新返回的凭据撤销
  await vi.waitFor(() => expect(cleanupRequests).toHaveLength(1))
  expect(cleanupRequests[0]).toMatchObject({
    body: { refresh_token: 'refresh-1', revoke_all: false },
    authorization: 'Bearer access-1',
  })
})

it('旧账号刷新失败不能清除刚切换的新账号', async () => {
  let finishRefresh!: (response: Response) => void
  const refreshed = new Promise<Response>((resolve) => { finishRefresh = resolve })
  let refreshStarted = false
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/auth/refresh')) { refreshStarted = true; return refreshed }
    return unauthorized()
  }))
  const pending = apiClient.get('/me').catch(() => undefined)
  await vi.waitFor(() => expect(refreshStarted).toBe(true))
  const nextUser = { ...user, id: 'other-user', username: '另一个账号' }
  useAuthStore.setState({ user: nextUser, accessToken: 'other-access', refreshToken: 'other-refresh', isAuthenticated: true })
  finishRefresh(unauthorized())
  await pending
  expect(useAuthStore.getState()).toMatchObject({ user: nextUser, accessToken: 'other-access', refreshToken: 'other-refresh', isAuthenticated: true })
})

it('刷新先返回、登出后返回时仍然完成登出', async () => {
  let finishRefresh!: (response: Response) => void
  let finishLogout!: (response: Response) => void
  vi.stubGlobal('fetch', vi.fn((url: string, options: RequestInit) => new Promise<Response>((resolve) => {
    if (url.endsWith('/auth/refresh')) {
      finishRefresh = resolve
      return
    }
    // 原退出请求（refresh-0）保留手动完成控制；会话结束后的清理请求（refresh-1）立即返回，
    // 不能覆盖原 resolver，否则原退出任务会一直悬挂
    if (JSON.parse(String(options.body)).refresh_token === 'refresh-0') {
      finishLogout = resolve
      return
    }
    resolve(json({ data: { ok: true } }))
  })))
  const refreshing = useAuthStore.getState().refreshAccessToken().catch(() => undefined)
  const loggingOut = useAuthStore.getState().logout()
  finishRefresh(json({ data: { access_token: 'access-1', refresh_token: 'refresh-1', token_type: 'Bearer', expires_in: 900 } }))
  await refreshing
  finishLogout(json({ data: { ok: true } }))
  await loggingOut
  expect(useAuthStore.getState()).toMatchObject({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false })
})

it('重新登录同一账号后，不得用新会话凭据重试上次登录发出的请求', async () => {
  let finishOriginal!: (response: Response) => void
  const fetch = vi.fn((url: string, options: RequestInit) => {
    if (url.endsWith('/auth/login')) {
      return Promise.resolve(json({ data: { user, access_token: 'new-login-access', refresh_token: 'new-login-refresh' } }))
    }
    if (new Headers(options.headers).get('Authorization') === 'Bearer access-0') {
      return new Promise<Response>((resolve) => { finishOriginal = resolve })
    }
    return Promise.resolve(json({ data: { unexpectedRetry: true } }))
  })
  vi.stubGlobal('fetch', fetch)
  const pending = apiClient.get('/me').catch((error: unknown) => error)
  useAuthStore.getState().clearAuth()
  await useAuthStore.getState().login('测试账号', '测试密码')
  finishOriginal(unauthorized())
  expect(await pending).toMatchObject({ status: 401 })
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(useAuthStore.getState()).toMatchObject({ user, accessToken: 'new-login-access', isAuthenticated: true })
})

it('刷新失败清理旧状态后，API 错误处理不能再次清除随后建立的会话', async () => {
  const nextUser = { ...user, id: 'another-user', username: '新账号' }
  let switched = false
  const unsubscribe = useAuthStore.subscribe((state) => {
    if (state.isAuthenticated || switched) return
    switched = true
    useAuthStore.setState({ user: nextUser, accessToken: 'new-access', refreshToken: 'new-refresh', isAuthenticated: true })
  })
  vi.stubGlobal('fetch', vi.fn(async () => unauthorized()))
  try {
    await expect(apiClient.get('/me')).rejects.toMatchObject({ status: 401 })
    expect(useAuthStore.getState()).toMatchObject({ user: nextUser, accessToken: 'new-access', refreshToken: 'new-refresh', isAuthenticated: true })
  } finally {
    unsubscribe()
  }
})

it('刷新服务暂时不可用时保留会话，恢复后仍可刷新', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(json({ error: { code: 'UNAVAILABLE', message: '服务暂时不可用' } }, 503))
    .mockResolvedValueOnce(json({ data: { access_token: 'access-1', refresh_token: 'refresh-1', token_type: 'Bearer', expires_in: 900 } }))
  vi.stubGlobal('fetch', fetch)
  await expect(useAuthStore.getState().refreshAccessToken()).rejects.toMatchObject({ status: 503 })
  expect(useAuthStore.getState()).toMatchObject({ user, accessToken: 'access-0', refreshToken: 'refresh-0', isAuthenticated: true })
  await useAuthStore.getState().refreshAccessToken()
  expect(useAuthStore.getState()).toMatchObject({ user, accessToken: 'access-1', refreshToken: 'refresh-1', isAuthenticated: true })
})

it('较早请求的 401 迟到时直接复用已轮换的访问令牌', async () => {
  let finishOriginal!: (response: Response) => void
  const fetch = vi.fn((url: string, options: RequestInit) => {
    if (url.endsWith('/auth/refresh')) {
      return Promise.resolve(json({ data: { access_token: 'access-1', refresh_token: 'refresh-1', token_type: 'Bearer', expires_in: 900 } }))
    }
    if (new Headers(options.headers).get('Authorization') === 'Bearer access-0') {
      return new Promise<Response>((resolve) => { finishOriginal = resolve })
    }
    return Promise.resolve(json({ data: { ok: true } }))
  })
  vi.stubGlobal('fetch', fetch)
  const pending = apiClient.get('/me')
  await useAuthStore.getState().refreshAccessToken()
  finishOriginal(unauthorized())
  await expect(pending).resolves.toEqual({ data: { ok: true } })
  expect(fetch.mock.calls.filter(([url]) => url.endsWith('/auth/refresh'))).toHaveLength(1)
})
