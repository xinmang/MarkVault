import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ShareSettingsTab } from '../src/components/settings/tabs/ShareSettingsTab'

const mocks = vi.hoisted(() => ({
  data: { enabled: true, slug: 'saved-share', title: '', description: '' } as object | undefined,
  loading: false,
  error: false,
  pending: false,
  save: vi.fn(),
}))
vi.mock('@/hooks/useShare', () => ({
  useShareSettings: () => ({
    data: mocks.data,
    isLoading: mocks.loading,
    isError: mocks.error,
    refetch: vi.fn(),
  }),
  useUpdateShareSettings: () => ({ mutateAsync: mocks.save, isPending: mocks.pending }),
}))
vi.mock('@/stores/toastStore', () => ({ useToastStore: () => ({ addToast: vi.fn() }) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../src/components/settings/useDefaultManagementTheme', () => ({
  useDefaultManagementTheme: () => true,
}))
beforeEach(() => {
  vi.stubGlobal('window', { location: { origin: 'http://localhost:8787' } })
  mocks.data = { enabled: true, slug: 'saved-share', title: '', description: '' }
  mocks.loading = false
  mocks.error = false
  mocks.pending = false
})
afterEach(() => vi.unstubAllGlobals())
describe('公开分享保存入口', () => {
  it('分享关闭草稿仍可保存，不能因配置区隐藏而失去关闭入口', () => {
    // 无 DOM 渲染不执行同步效果，初始关闭草稿与服务器已开启状态不同。
    const html = renderToStaticMarkup(<ShareSettingsTab />)
    expect(html).not.toContain('id="share-slug"')
    expect(html).toMatch(/<button[^>]*class="btn btn-sm btn-primary"[^>]*>action.save</)
    expect(html).toContain('message.unsavedChanges')
    expect(html).toContain('action.discard')
  })
  it('读取失败不提供会覆盖服务端状态的保存按钮', () => {
    mocks.error = true
    mocks.data = undefined
    const html = renderToStaticMarkup(<ShareSettingsTab />)
    expect(html).toContain('role="alert"')
    expect(html).not.toContain('action.save')
  })
  it('保存期间禁用表单和保存按钮，避免重复提交', () => {
    mocks.pending = true
    const html = renderToStaticMarkup(<ShareSettingsTab />)
    expect(html).toContain('<fieldset disabled=""')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>action.saving</)
  })
})
