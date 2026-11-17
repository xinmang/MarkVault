import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { PluginState } from '../shared/plugin-types'
import { PluginContext } from '../src/plugins/context'
import { HeaderActions } from '../src/components/layout/HeaderActions'
import { MobileBottomNav } from '../src/components/layout/MobileBottomNav'
import { BuiltinPluginGate } from '../src/plugins/BuiltinPluginGate'
import { RelatedPlugins } from '../src/components/settings/RelatedPlugins'
import { featureSettingsPath, getBuiltinNavigation } from '../src/plugins/navigation'
import { PageSpeedProvider } from '../plugins/builtin/page-speed/PageSpeedProvider'
import { PageSpeedBadge } from '../plugins/builtin/page-speed/PageSpeedBadge'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  // 功能列表按界面语言显示名称，需要 i18n.language
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'zh-CN' } }),
}))
vi.mock('../src/components/common/ThemeToggle', () => ({ ThemeToggle: () => null }))
vi.mock('../src/components/common/ColorThemeSelector', () => ({ ColorThemeSelector: () => null }))

function plugin(id: string, overrides: Partial<PluginState> = {}): PluginState {
  return {
    manifest: {
      id: 'markvault.' + id,
      name: id,
      version: '1.0.0',
      api: '^1.0.0',
      author: '测试',
      permissions: [],
      contributes: [],
    },
    origin: 'builtin',
    enabled: true,
    disabled: false,
    status: 'running',
    config: {},
    grants: [],
    revision: '1',
    ...overrides,
  }
}
function render(
  children: ReactNode,
  plugins: PluginState[],
  ready = true,
  safe = false,
  url = '/'
) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[url]}>
      <PluginContext.Provider
        value={{
          directory: { plugins, admin: false, apiVersion: '1.0.0', runtimeAvailable: true },
          ready,
          safe,
          refresh: async () => undefined,
        }}
      >
        {children}
      </PluginContext.Provider>
    </MemoryRouter>
  )
}

describe('内置功能启停与入口一致', () => {
  it('测速插件仅在目录就绪并运行时挂载，停用和安全模式不显示徽标', () => {
    const badge = (
      <PageSpeedProvider>
        <PageSpeedBadge />
      </PageSpeedProvider>
    )
    expect(render(badge, [plugin('page-speed')])).toContain('page-speed__trigger')
    for (const html of [
      render(badge, [], false),
      render(badge, [plugin('page-speed')], true, true),
      render(badge, [plugin('page-speed', { enabled: false, status: 'disabled' })]),
      render(badge, [plugin('page-speed', { disabled: true })]),
    ])
      expect(html).not.toContain('page-speed__trigger')
    expect(getBuiltinNavigation('markvault.page-speed')).toEqual({
      category: 'insights',
      section: 'statistics',
    })
  })
  it('公开页保留 Agent 图标入口并高亮当前页，页头不再有插件入口', () => {
    const html = render(<HeaderActions publicPage />, [], false, false, '/agent')
    expect(html).not.toContain('plugins:title')
    expect(html).toContain('aria-label="nav.agent"')
    expect(html).toContain('aria-current="page"')
    expect(html).not.toContain('aria-label="nav.statistics"')
  })
  it('浏览器扩展归在连接分区，手机导航不再有插件入口', () => {
    expect(getBuiltinNavigation('markvault.browser-extension')).toEqual({
      category: 'connections',
      section: 'connections',
      page: '/extension',
    })
    const html = render(<MobileBottomNav />, [])
    expect(html).not.toContain('plugins:title')
    expect(html).not.toContain('nav.extension')
    const stopped = render(<RelatedPlugins section="connections" />, [
      plugin('browser-extension', { enabled: false, status: 'disabled' }),
    ])
    expect(stopped).toContain('data-plugin-id="markvault.browser-extension"')
    expect(stopped).not.toContain('href="/plugins')
    expect(stopped).not.toContain('href="/extension"')
    expect(
      render(<RelatedPlugins section="connections" />, [plugin('browser-extension')])
    ).toContain('href="/extension"')
  })
  it('内置功能的设置地址定位到所属分区，由选择器管理的功能不带条目参数', () => {
    expect(featureSettingsPath('markvault.ocean')).toBe(
      '/settings/general?section=motion&plugin=markvault.ocean'
    )
    expect(featureSettingsPath('markvault.ascii')).toBe('/settings/general?section=theme')
    expect(featureSettingsPath('markvault.home-reader', true)).toBe(
      '/settings/general?section=theme&safe=1'
    )
    expect(featureSettingsPath('example.notes')).toBe('/settings/general')
  })
  it('停用助手同时隐藏桌面和手机入口，图表入口独立保留', () => {
    const disabled = [plugin('agent', { enabled: false, status: 'disabled' }), plugin('statistics')]
    const header = render(<HeaderActions />, disabled)
    expect(header).not.toContain('aria-label="nav.agent"')
    expect(header).toContain('aria-label="nav.statistics"')
    const mobile = render(<MobileBottomNav />, disabled)
    expect(mobile).not.toContain('nav.agent')
    expect(mobile).toContain('repeat(2, minmax(0, 1fr))')
    const enabled = [plugin('agent'), plugin('statistics', { enabled: false, status: 'disabled' })]
    expect(render(<HeaderActions />, enabled)).toContain('aria-label="nav.agent"')
    expect(render(<HeaderActions />, enabled)).not.toContain('aria-label="nav.statistics"')
    expect(render(<MobileBottomNav />, enabled)).toContain('nav.agent')
  })
  it.each(['agent', 'statistics', 'browser-extension'])(
    '%s 未就绪或停用时不渲染功能页面，启用后恢复',
    (id) => {
      let renders = 0
      function Content() {
        renders++
        return <div>功能内容</div>
      }
      const page = (
        <BuiltinPluginGate id={id}>
          <Content />
        </BuiltinPluginGate>
      )
      expect(render(page, [plugin(id)], false)).toContain('role="status"')
      const stopped = render(page, [plugin(id, { enabled: false, status: 'disabled' })])
      expect(stopped).toContain('/settings/general?section=')
      expect(stopped).toContain('plugin=markvault.' + id)
      expect(stopped).not.toContain('href="/plugins')
      expect(stopped).toContain('featureUnavailable')
      render(page, [plugin(id, { disabled: true })])
      render(page, [plugin(id, { status: 'waiting' })])
      expect(render(page, [plugin(id)], true, true)).toContain('safe=1')
      expect(renders).toBe(0)
      expect(render(page, [plugin(id)])).toContain('功能内容')
      expect(renders).toBe(1)
    }
  )
  it('加载中和安全模式不闪现功能入口', () => {
    const plugins = [plugin('agent'), plugin('statistics')]
    for (const html of [
      render(<HeaderActions />, plugins, false),
      render(<HeaderActions />, plugins, true, true),
    ]) {
      expect(html).not.toContain('aria-label="nav.agent"')
      expect(html).not.toContain('aria-label="nav.statistics"')
    }
  })
  it('每个分区只列出自己的功能，关闭后保留开关并隐藏打开功能', () => {
    const items = [
      plugin('agent'),
      plugin('motion'),
      plugin('statistics', { enabled: false, status: 'disabled' }),
    ]
    const assistant = render(<RelatedPlugins section="ai" />, items)
    expect(assistant).toContain('href="/agent/chat"')
    expect(assistant).not.toContain('markvault.motion')
    const statistics = render(<RelatedPlugins section="statistics" />, items)
    expect(statistics).not.toContain('href="/statistics"')
    expect(statistics).not.toContain('href="/plugins')
    expect(statistics).toMatch(/<input type="checkbox"(?![^>]*checked)[^>]*aria-label="toggleNamedPlugin"/)
    // 开关已经表达开与关，正常状态不再另外显示状态文字
    expect(statistics).not.toContain('settings-plugin-status')
    expect(assistant).not.toContain('settings-plugin-status')
  })
  it('开着却没在运行、或被管理员停用时标出状态', () => {
    expect(render(<RelatedPlugins section="ai" />, [plugin('agent', { status: 'failed' })])).toMatch(
      /class="settings-plugin-status"[^>]*data-status="failed"[^>]*>status\.failed/
    )
    expect(
      render(<RelatedPlugins section="ai" />, [plugin('agent', { disabled: true })])
    ).toContain('instanceDisabled')
  })
  it('界面主题、页面版式和第三方插件不作为带开关的条目列出', () => {
    const third = plugin('x', { origin: 'community' })
    third.manifest.id = 'example.theme'
    third.manifest.category = 'appearance'
    const html = render(<RelatedPlugins section="theme" />, [
      plugin('classic'),
      plugin('vibehub'),
      plugin('ascii'),
      plugin('home-topbar'),
      plugin('palettes'),
      third,
    ])
    expect([...html.matchAll(/data-plugin-id="([^"]+)"/g)].map((match) => match[1])).toEqual([
      'markvault.palettes',
    ])
  })
  it('图床的启停在自己的设置面板里：条目没有快捷开关，关闭时也能展开', () => {
    const hosting = plugin('image-hosting', { enabled: false, status: 'disabled' })
    const panel = { 'markvault.image-hosting': <p>图床面板</p> }
    const url = '/settings/general?section=connections&plugin=markvault.image-hosting'
    const html = render(<RelatedPlugins section="connections" settings={panel} />, [hosting], true, false, url)
    expect(html).not.toContain('type="checkbox"')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('图床面板')
    expect(html).toContain('status.disabled')
    for (const blocked of [
      render(<RelatedPlugins section="connections" settings={panel} />, [hosting], true, true, url),
      render(
        <RelatedPlugins section="connections" settings={panel} />,
        [plugin('image-hosting', { disabled: true })],
        true,
        false,
        url
      ),
    ])
      expect(blocked).not.toContain('图床面板')
  })
  it('海洋设置深链接在对应插件条目内展开，其他插件配置保持收起', () => {
    const html = render(
      <RelatedPlugins
        section="motion"
        settings={{
          'markvault.ocean': <input aria-label="海洋样式" />,
          'markvault.motion': <p>动效说明</p>,
        }}
      />,
      [plugin('ocean'), plugin('motion')],
      true,
      false,
      '/settings/general?section=motion&plugin=markvault.ocean'
    )
    expect(html).toMatch(
      /data-plugin-id="markvault.ocean".*aria-expanded="true".*id="settings-panel-markvault.ocean"/s
    )
    expect(html).toContain('aria-label="海洋样式"')
    expect(html).toMatch(/id="settings-panel-markvault.motion"[^>]*hidden=""/)
  })
  it.each(['disabled', 'waiting', 'unavailable', 'failed'] as const)(
    '插件 %s 时不挂载配置，不通过深链接绕过状态',
    (status) => {
      let renders = 0
      function Content() {
        renders++
        return <input aria-label="海洋样式" />
      }
      const html = render(
        <RelatedPlugins section="motion" settings={{ 'markvault.ocean': <Content /> }} />,
        [plugin('ocean', { enabled: status !== 'disabled', status })],
        true,
        false,
        '/settings/general?section=motion&plugin=markvault.ocean'
      )
      expect(renders).toBe(0)
      expect(html).not.toContain('aria-label="海洋样式"')
      expect(html).toContain('aria-expanded="false"')
    }
  )
  it('实例停用与安全模式禁止快捷开关，配置面板不执行', () => {
    const section = (
      <RelatedPlugins
        section="motion"
        settings={{ 'markvault.ocean': <input aria-label="海洋样式" /> }}
      />
    )
    for (const html of [
      render(section, [plugin('ocean', { disabled: true })]),
      render(section, [plugin('ocean')], true, true),
    ]) {
      expect(html).toMatch(/type="checkbox"[^>]*disabled=""/)
      expect(html).not.toContain('aria-label="海洋样式"')
    }
  })
})
