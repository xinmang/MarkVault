import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import type { PluginState } from '../shared/plugin-types'
import { PluginContext } from '../src/plugins/context'
import { localizedText, pluginShortId } from '../src/plugins/localize'
import {
  PluginSettingsForm,
  buildPluginConfig,
  initialConfig,
  schemaFields,
} from '../src/plugins/PluginSettingsForm'
import { PLUGIN_ICON_NAMES, PluginIcon, resolvePluginIcon } from '../src/plugins/icons'
import { RelatedPlugins } from '../src/components/settings/RelatedPlugins'
import { CustomPluginsSection } from '../src/components/settings/CustomPluginsSection'
import { PluginDetailPage, PluginsPage } from '../src/pages/plugins/PluginsPage'
import zh from '../src/i18n/locales/zh-CN/plugins.json'
import en from '../src/i18n/locales/en/plugins.json'

// 与 plugins/builtins.go 的 asciiSettings 保持同样的结构
const asciiSettings = {
  type: 'object',
  additionalProperties: false,
  properties: {
    boot: {
      type: 'boolean',
      default: true,
      title: '启动序列 / Boot sequence',
      description: '进入页面时播放启动动画 / Play the boot animation.',
    },
    background: {
      type: 'string',
      enum: ['field', 'rain', 'off'],
      default: 'field',
      title: '字符背景 / Character background',
    },
    scanlines: { type: 'boolean', default: true, title: '扫描线 / Scanlines' },
    glitch: { type: 'boolean', default: true, title: '故障闪烁 / Glitch flicker' },
    density: {
      type: 'integer',
      minimum: 40,
      maximum: 160,
      default: 100,
      title: '字符密度 / Glyph density',
      description: '背景字符的疏密 / Background glyph density.',
    },
  },
}

// 覆盖表单支持的每一种控件
const mixedSettings = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 2, maxLength: 20, title: '名称 / Name' },
    mode: { type: 'string', enum: ['a', 'b', 'c', 'd', 'e'], default: 'c' },
    retries: { type: 'integer', minimum: 0, default: 3 },
    ratio: { type: 'number', minimum: 0, maximum: 1, default: 0.5 },
    purposes: {
      type: 'array',
      items: { type: 'string', enum: ['cover', 'favicon'] },
      maxItems: 1,
    },
    advanced: { type: 'object', properties: { depth: { type: 'integer' } } },
    codes: { type: 'integer', enum: [1, 2] },
  },
}

// 每种界面语言一个独立实例，避免渲染时再异步切换语言
const languages = { 'zh-CN': i18next.createInstance(), en: i18next.createInstance() }
beforeAll(async () => {
  for (const [lng, instance] of Object.entries(languages))
    await instance.init({
      lng,
      fallbackLng: 'zh-CN',
      ns: ['plugins'],
      defaultNS: 'plugins',
      resources: { 'zh-CN': { plugins: zh }, en: { plugins: en } },
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    })
})

function plugin(id: string, overrides: Partial<PluginState> = {}, settings?: object): PluginState {
  return {
    manifest: {
      id: 'markvault.' + id,
      name: id,
      version: '1.0.0',
      api: '^1.0.0',
      author: '测试',
      permissions: [],
      settings: settings as Record<string, unknown> | undefined,
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
  {
    plugins = [] as PluginState[],
    language = 'zh-CN' as keyof typeof languages,
    safe = false,
    admin = false,
    url = '/',
  } = {}
) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={languages[language]}>
      <MemoryRouter initialEntries={[url]}>
        <PluginContext.Provider
          value={{
            directory: { plugins, admin, apiVersion: '1.0.0', runtimeAvailable: true },
            ready: true,
            safe,
            refresh: async () => undefined,
          }}
        >
          {children}
        </PluginContext.Provider>
      </MemoryRouter>
    </I18nextProvider>
  )
}

describe('双语文本按界面语言取一半', () => {
  it('恰好两段时中文取前一段、英文取后一段', () => {
    expect(localizedText('启动序列 / Boot sequence', 'zh-CN')).toBe('启动序列')
    expect(localizedText('启动序列 / Boot sequence', 'en')).toBe('Boot sequence')
    expect(localizedText('启动序列 / Boot sequence', 'en-US')).toBe('Boot sequence')
    // 未支持的语言与 i18n 的回退语言一致
    expect(localizedText('启动序列 / Boot sequence', 'fr')).toBe('启动序列')
  })
  it('其他写法原样返回', () => {
    for (const text of ['VibeHub', 'UI/UX Pro', '甲 / 乙 / 丙', ' / English', '中文 / ', ''])
      expect(localizedText(text, 'en')).toBe(text)
  })
  it('内置插件的文案键去掉 markvault. 前缀', () => {
    expect(pluginShortId('markvault.ascii')).toBe('ascii')
    expect(pluginShortId('example.notes')).toBe('example.notes')
  })
})

describe('设置 Schema 推导表单字段', () => {
  it('ASCII 主题的五个选项对应开关、分段单选和滑块', () => {
    const fields = schemaFields(asciiSettings)
    expect(fields.map((field) => [field.name, field.kind])).toEqual([
      ['boot', 'boolean'],
      ['background', 'segmented'],
      ['scanlines', 'boolean'],
      ['glitch', 'boolean'],
      ['density', 'range'],
    ])
    expect(fields[1]).toMatchObject({ options: ['field', 'rain', 'off'], default: 'field' })
    expect(fields[4]).toMatchObject({ integer: true, minimum: 40, maximum: 160, required: false })
  })
  it('按类型选择控件，无法表达的结构退回 JSON', () => {
    const fields = Object.fromEntries(
      schemaFields(mixedSettings).map((field) => [field.name, field])
    )
    expect(fields.name).toMatchObject({
      kind: 'text',
      required: true,
      minLength: 2,
      maxLength: 20,
      title: '名称 / Name',
    })
    // 选项超过四个改用下拉框，缺少 title 时用属性名
    expect(fields.mode).toMatchObject({ kind: 'select', title: 'mode' })
    // 只有下限没有上限的数值用数字输入框
    expect(fields.retries).toMatchObject({ kind: 'number', integer: true, minimum: 0 })
    expect(fields.ratio).toMatchObject({ kind: 'range', integer: false })
    expect(fields.purposes).toMatchObject({
      kind: 'multi',
      options: ['cover', 'favicon'],
      maxItems: 1,
    })
    expect(fields.advanced?.kind).toBe('json')
    expect(fields.codes?.kind).toBe('json')
  })
  it('没有可渲染的属性时返回空列表', () => {
    for (const schema of [undefined, null, 'x', {}, { type: 'object' }, { type: 'string' }])
      expect(schemaFields(schema)).toEqual([])
    expect(schemaFields({ type: 'object', properties: {} })).toEqual([])
  })
})

describe('表单初始值与提交内容', () => {
  it('已保存的值优先，缺省用 Schema 默认值', () => {
    expect(initialConfig(asciiSettings, { boot: false, density: 60 })).toEqual({
      boot: false,
      background: 'field',
      scanlines: true,
      glitch: true,
      density: 60,
    })
    expect(initialConfig(asciiSettings)).toEqual({
      boot: true,
      background: 'field',
      scanlines: true,
      glitch: true,
      density: 100,
    })
  })
  it('类型不符、越界或不在枚举内的值改用默认值，未声明的键不进入表单', () => {
    expect(
      initialConfig(asciiSettings, {
        boot: 'yes',
        background: 'matrix',
        density: 999,
        legacy: true,
      })
    ).toEqual({ boot: true, background: 'field', scanlines: true, glitch: true, density: 100 })
  })
  it('没有默认值时开关为关、滑块取下限、多选为空，其余保持未设置', () => {
    expect(
      initialConfig({
        type: 'object',
        properties: {
          on: { type: 'boolean' },
          level: { type: 'number', minimum: 2, maximum: 8 },
          tags: { type: 'array', items: { type: 'string', enum: ['a'] } },
          text: { type: 'string' },
          count: { type: 'integer' },
          choice: { type: 'string', enum: ['x', 'y'] },
        },
      })
    ).toEqual({ on: false, level: 2, tags: [] })
    expect(initialConfig(mixedSettings, { purposes: ['favicon', '未知', 'cover'] })).toEqual({
      mode: 'c',
      retries: 3,
      ratio: 0.5,
      purposes: ['cover', 'favicon'],
    })
  })
  it('只提交 Schema 声明的属性；Schema 允许额外属性时保留原有的未知键', () => {
    const values = { boot: false, background: 'rain', density: 80, stray: 1, glitch: undefined }
    expect(buildPluginConfig(asciiSettings, values, { legacy: true, boot: true })).toEqual({
      boot: false,
      background: 'rain',
      density: 80,
    })
    expect(
      buildPluginConfig(mixedSettings, { name: '甲乙' }, { legacy: true, name: '旧' })
    ).toEqual({ legacy: true, name: '甲乙' })
  })
})

describe('Schema 设置表单的渲染', () => {
  const ascii = plugin('ascii', { config: { background: 'rain', density: 60 } }, asciiSettings)

  it('中文界面显示中文标签、说明与枚举名称，并带出已保存的值', () => {
    const html = render(<PluginSettingsForm plugin={ascii} />)
    expect(html).toContain('class="plugin-form"')
    expect(html).toContain('启动序列')
    expect(html).not.toContain('Boot sequence')
    expect(html).toContain('进入页面时播放启动动画')
    // 三个布尔项是开关
    expect(html.match(/type="checkbox"/g)).toHaveLength(3)
    expect(html).toContain('aria-label="启动序列"')
    // 枚举不超过四项时是分段单选，已保存的 rain 被选中
    expect(html).toContain('role="radiogroup"')
    expect(html).toMatch(/data-checked="true"[^>]*><input type="radio"[^>]*value="rain"/)
    expect(html).toContain('字符场')
    expect(html).toContain('字符雨')
    expect(html).toContain('<span>关闭</span>')
    // 有上下限的整数是滑块，旁边显示当前值
    expect(html).toMatch(/type="range"[^>]*min="40"[^>]*max="160"[^>]*value="60"/)
    expect(html).toMatch(/<output[^>]*>60<\/output>/)
    // 没有改动时不出现保存与还原，恢复默认值始终可见
    expect(html).not.toContain('>保存<')
    expect(html).not.toContain('>还原<')
    expect(html).toContain('恢复默认值')
  })
  it('英文界面只显示英文一半', () => {
    const html = render(<PluginSettingsForm plugin={ascii} />, { language: 'en' })
    expect(html).toContain('Boot sequence')
    expect(html).toContain('Play the boot animation.')
    expect(html).not.toContain('启动序列')
    expect(html).toContain('Character field')
    expect(html).toContain('Glyph rain')
    expect(html).toContain('Restore defaults')
  })
  it('每个控件有可访问名称，说明通过 aria-describedby 关联', () => {
    const html = render(<PluginSettingsForm plugin={ascii} />)
    const label = /<span id="([^"]+)" class="plugin-form__label">字符密度/.exec(html)?.[1]
    const hint = /<p id="([^"]+)" class="plugin-form__hint">背景字符的疏密/.exec(html)?.[1]
    expect(label).toBeTruthy()
    expect(hint).toBeTruthy()
    const range = /<input type="range"[^>]*>/.exec(html)?.[0]
    expect(range).toContain(`aria-labelledby="${label}"`)
    expect(range).toContain(`aria-describedby="${hint}"`)
    // 开关的说明由字段分组关联
    expect(html).toMatch(/role="group" aria-labelledby="[^"]+" aria-describedby="[^"]+"/)
    // 没有说明的字段不输出悬空的引用
    expect(/<div class="plugin-form__segmented"[^>]*>/.exec(html)?.[0]).not.toContain(
      'aria-describedby'
    )
  })
  it('文本、下拉、数字、多选与 JSON 回退各自渲染对应控件', () => {
    const html = render(
      <PluginSettingsForm
        plugin={plugin(
          'mixed',
          { config: { name: '示例', purposes: ['cover'], advanced: { depth: 2 } } },
          mixedSettings
        )}
      />
    )
    expect(html).toMatch(/<input type="text"[^>]*minLength="2"[^>]*maxLength="20"[^>]*value="示例"/)
    expect(html).toContain('名称')
    expect(html).toContain('plugin-form__required')
    expect(html).toMatch(/<select[^>]*>.*<option value="c" selected="">c<\/option>/s)
    expect(html).toMatch(/<input type="number"[^>]*min="0"[^>]*step="1"[^>]*value="3"/)
    expect(html).toMatch(/type="range"[^>]*step="any"[^>]*value="0.5"/)
    // 多选达到 maxItems 后，未选中的项不可再勾选
    expect(html).toMatch(/<input type="checkbox" checked=""\/><span>cover<\/span>/)
    expect(html).toMatch(/<input type="checkbox" disabled=""\/><span>favicon<\/span>/)
    expect(html).toMatch(/<textarea[^>]*aria-invalid="false"[^>]*>\{\s+&quot;depth&quot;: 2\s+\}/)
  })
  it('没有设置 Schema 或没有属性时不渲染', () => {
    expect(render(<PluginSettingsForm plugin={plugin('classic')} />)).toBe('')
    expect(
      render(
        <PluginSettingsForm plugin={plugin('empty', {}, { type: 'object', properties: {} })} />
      )
    ).toBe('')
  })
  it('实例停用的插件表单只读', () => {
    const html = render(<PluginSettingsForm plugin={{ ...ascii, disabled: true }} />)
    expect(html.match(/type="checkbox"[^>]*disabled=""/g)).toHaveLength(3)
    expect(html).toMatch(/type="range"[^>]*disabled=""/)
  })
})

describe('插件图标', () => {
  it('内置插件登记的图标名全部有映射', () => {
    const source = readFileSync(new URL('../plugins/builtins.go', import.meta.url), 'utf8')
    const names = [
      ...new Set([...source.matchAll(/\bicon:\s*"([^"]+)"/g)].map((match) => match[1])),
    ]
    expect(names.length).toBeGreaterThan(20)
    expect(names.filter((name) => !PLUGIN_ICON_NAMES.includes(name!))).toEqual([])
  })
  it('未声明或未知的图标名按分类取默认图标，再兜底拼图', () => {
    expect(resolvePluginIcon('terminal')).not.toBe(resolvePluginIcon())
    expect(resolvePluginIcon('不存在', 'effects')).toBe(resolvePluginIcon('sparkles'))
    expect(resolvePluginIcon(undefined, 'connections')).toBe(resolvePluginIcon('cable'))
    expect(resolvePluginIcon('constructor')).toBe(resolvePluginIcon('puzzle'))
    expect(resolvePluginIcon()).toBe(resolvePluginIcon('puzzle'))
  })
  it('按清单的 icon 渲染，缺省时跟随分类', () => {
    const terminal = plugin('ascii')
    terminal.manifest.icon = 'terminal'
    expect(render(<PluginIcon plugin={terminal} />)).toContain('lucide-terminal')
    const themed = plugin('example')
    themed.manifest.category = 'appearance'
    expect(render(<PluginIcon plugin={themed} />)).toContain('lucide-palette')
    expect(render(<PluginIcon plugin={plugin('unknown')} />)).toContain('lucide-puzzle')
  })
})

describe('设置页的功能列表', () => {
  it('带设置 Schema 的功能自动提供可展开的表单，深链接展开对应条目', () => {
    const items = [plugin('motion', {}, asciiSettings), plugin('cursor')]
    const url = '/settings/general?section=motion&plugin=markvault.motion'
    const html = render(<RelatedPlugins section="motion" />, { plugins: items, url })
    expect(html).toMatch(
      /data-plugin-id="markvault.motion".*aria-expanded="true".*id="settings-panel-markvault.motion"/s
    )
    expect(html).toContain('data-plugin-form="markvault.motion"')
    expect(html).toContain('字符背景')
    // 没有设置的功能不出现展开按钮，但同样有开关
    expect(html.match(/aria-expanded=/g)).toHaveLength(1)
    expect(html.match(/type="checkbox"[^>]*aria-label="启用 /g)).toHaveLength(2)
    // 未指定深链接时面板保持收起
    expect(render(<RelatedPlugins section="motion" />, { plugins: items })).toMatch(
      /id="settings-panel-markvault.motion"[^>]*hidden=""/
    )
  })
  it('调用方提供的专用面板优先于自动表单', () => {
    const html = render(
      <RelatedPlugins section="motion" settings={{ 'markvault.motion': <p>专用面板</p> }} />,
      { plugins: [plugin('motion', {}, asciiSettings)] }
    )
    expect(html).toContain('专用面板')
    expect(html).not.toContain('data-plugin-form')
  })
  it('第三方插件不出现在设置页的功能列表里，图床不自动生成表单', () => {
    const third = plugin('x', { origin: 'community' }, asciiSettings)
    third.manifest.id = 'example.terminal'
    third.manifest.category = 'connections'
    const hosting = plugin('image-hosting', {}, asciiSettings)
    const html = render(<RelatedPlugins section="connections" />, { plugins: [third, hosting] })
    expect(html).not.toContain('example.terminal')
    expect(html).toContain('data-plugin-id="markvault.image-hosting"')
    expect(html).not.toContain('data-plugin-form')
    expect(html).not.toContain('id="settings-panel-markvault.image-hosting"')
  })
  it('未运行、实例停用或安全模式时不挂载表单', () => {
    const url = '/settings/general?section=motion&plugin=markvault.motion'
    for (const html of [
      render(<RelatedPlugins section="motion" />, {
        plugins: [plugin('motion', { enabled: false, status: 'disabled' }, asciiSettings)],
        url,
      }),
      render(<RelatedPlugins section="motion" />, {
        plugins: [plugin('motion', { disabled: true }, asciiSettings)],
        url,
      }),
      render(<RelatedPlugins section="motion" />, {
        plugins: [plugin('motion', {}, asciiSettings)],
        safe: true,
        url,
      }),
    ]) {
      expect(html).not.toContain('data-plugin-form')
      expect(html).toContain('aria-expanded="false"')
    }
  })
  it('名称按界面语言显示，条目带图标、说明和开关，不再链接到插件详情', () => {
    const item = plugin('motion')
    item.manifest.name = '交互动效 / Motion'
    item.manifest.icon = 'activity'
    const chinese = render(<RelatedPlugins section="motion" />, { plugins: [item] })
    expect(chinese).toContain('<span class="settings-plugin-name">交互动效</span>')
    expect(chinese).toContain('lucide-activity')
    expect(chinese).toContain(zh.summary.motion)
    expect(chinese).toContain('aria-label="启用 交互动效"')
    expect(chinese).toContain('>功能</h2>')
    expect(chinese).not.toContain('href="/plugins')
    expect(chinese).not.toContain('settings-plugin-status')
    const english = render(<RelatedPlugins section="motion" />, { plugins: [item], language: 'en' })
    expect(english).toContain('<span class="settings-plugin-name">Motion</span>')
    expect(english).toContain('aria-label="Enable Motion"')
  })
  it('条目按登记顺序排列，不随目录顺序或开关状态换位；异常状态与提醒直接显示在条目里', () => {
    const off = { enabled: false, status: 'disabled' as const }
    // 服务端目录按 ID 字母序返回
    const items = [
      plugin('cursor', { disabled: true }),
      plugin('motion', off),
      plugin('ocean', { status: 'failed' }),
      plugin('theme-transition'),
    ]
    const html = render(
      <RelatedPlugins section="motion" notes={{ 'markvault.cursor': '仅在某主题下生效' }} />,
      { plugins: items }
    )
    expect(
      [...html.matchAll(/data-plugin-id="markvault\.([^"]+)"/g)].map((match) => match[1])
    ).toEqual(['motion', 'ocean', 'cursor', 'theme-transition'])
    expect(html).toContain('启动失败')
    expect(html).toContain('管理员已停用')
    expect(html).toContain('<p class="settings-plugin-note">仅在某主题下生效</p>')
  })
})

describe('自定义插件页', () => {
  const third = (settings?: object, permissions: string[] = []) => {
    const item = plugin('x', { origin: 'community', digest: 'abc' }, settings)
    item.manifest.id = 'example.notes'
    item.manifest.name = '便笺 / Notes'
    item.manifest.permissions = permissions
    return item
  }
  const detail = (item: PluginState, language: 'zh-CN' | 'en' = 'zh-CN') =>
    render(
      <Routes>
        <Route path="/plugins/:pluginId" element={<PluginDetailPage />} />
      </Routes>,
      { plugins: [item], url: '/plugins/' + item.manifest.id, language }
    )

  it('只列出另外安装的插件，卡片显示本地化名称、状态徽标、可配置与权限数量', () => {
    const ascii = plugin('ascii', {}, asciiSettings)
    const html = render(<PluginsPage />, {
      plugins: [ascii, plugin('motion'), third(asciiSettings, ['storage.read', 'tags.read'])],
    })
    const card = (id: string) =>
      new RegExp(`<a[^>]*href="/plugins/${id}"[^>]*>.*?</a>`, 's').exec(html)?.[0] ?? ''
    expect(html).toContain('自定义插件')
    expect(html).not.toContain('href="/plugins/markvault.')
    expect(html).not.toContain('plugins-categories')
    expect(card('example.notes')).toContain('>便笺</h2>')
    expect(card('example.notes')).toMatch(/class="plugins-status[^"]*" data-status="running"/)
    expect(card('example.notes')).toContain('可配置')
    expect(card('example.notes')).toContain('2 项权限')
    // 内置功能在设置页管理，这里给出去设置页的入口
    expect(html).toContain('href="/settings/general"')
    // 状态、来源与能力筛选收在同一排工具栏
    const toolbar =
      /<div class="plugins-toolbar[^"]*">.*?class="plugins-count">1 个插件/s.exec(html)?.[0] ?? ''
    expect(toolbar).toContain('aria-label="按状态筛选"')
    expect(toolbar.match(/aria-pressed=/g)).toHaveLength(3)
    expect(toolbar).toContain('aria-label="按来源筛选"')
    expect(toolbar).not.toContain('<option value="builtin"')
    expect(toolbar).toContain('aria-label="按能力筛选"')
    expect(render(<PluginsPage />, { plugins: [ascii] })).toContain(zh.empty)
    const english = render(<PluginsPage />, { plugins: [ascii, third()], language: 'en' })
    expect(english).toContain('>Notes</h2>')
    expect(english).not.toContain('markvault.ascii')
  })
  it('详情页头部显示图标、名称、分类、版本、作者与状态', () => {
    const item = third()
    item.manifest.icon = 'code'
    item.manifest.category = 'connections'
    item.manifest.description = '保存便笺 / Keep notes'
    const header = /<header.*?<\/header>/s.exec(detail(item))?.[0] ?? ''
    expect(header).toContain('lucide-code')
    expect(header).toContain('>便笺</h1>')
    expect(header).toContain('连接与存储')
    expect(header).toContain('v1.0.0')
    expect(header).toContain('作者：测试')
    expect(header).toContain('data-status="running"')
    expect(header).toContain('保存便笺')
    expect(/<header.*?<\/header>/s.exec(detail(item, 'en'))?.[0]).toContain('>Notes</h1>')
  })
  it('带设置 Schema 的插件在详情页显示表单，JSON 收在高级入口里', () => {
    const html = detail(third(asciiSettings))
    expect(html).toContain('data-plugin-form="example.notes"')
    expect(html).not.toMatch(/<textarea[^>]*aria-label="插件设置（JSON）"/)
    expect(html).toContain('高级：编辑 JSON')
    // 已启用且无需授权时由表单自己保存，不再重复一个保存按钮
    expect(html).not.toContain('保存设置并启用')
    const stopped = detail({ ...third(asciiSettings), enabled: false, status: 'disabled' })
    expect(stopped).toContain('data-plugin-form="example.notes"')
    expect(stopped).toContain('授权并启用')
  })
  it('没有 Schema 的插件直接编辑 JSON', () => {
    const raw = detail({ ...third(), config: { greeting: '你好' } })
    expect(raw).toMatch(
      /<textarea[^>]*aria-label="插件设置（JSON）"[^>]*>\{\s+&quot;greeting&quot;/
    )
    expect(raw).not.toContain('高级：编辑 JSON')
    expect(raw).toContain('保存设置并启用')
  })
  it('没有权限时只用一行说明，有权限时列出授权项', () => {
    const none = detail(third())
    expect(none).toMatch(/<p class="plugin-permissions-none[^"]*">.*?此插件不请求额外业务权限/s)
    expect(none).not.toContain('class="plugin-permissions ')
    expect(none).toContain('data-permissions="false"')
    const some = detail(third(asciiSettings, ['storage.read']))
    expect(some).toContain('class="plugin-permissions ')
    expect(some).toContain('读取本插件存储')
    expect(some).toContain('data-permissions="true"')
    // 已启用但有权限可调整时保留保存按钮
    expect(some).toContain('保存设置并启用')
  })
  it('内置功能没有插件详情页，旧链接不再渲染详情', () => {
    const html = detail(plugin('ascii', {}, asciiSettings))
    expect(html).not.toContain('management-plugin-detail')
    expect(html).not.toContain('data-plugin-form')
    expect(detail(plugin('image-hosting', {}, asciiSettings))).not.toContain('<form')
  })
  it('设置页的自定义插件入口列出已安装的第三方插件，管理员另有全实例功能开关', () => {
    const plugins = [plugin('motion'), plugin('ocean', { disabled: true }), third()]
    const html = render(<CustomPluginsSection />, { plugins })
    expect(html).toContain('已安装的自定义插件')
    expect(html).toContain('href="/plugins"')
    expect(html).toMatch(
      /<a class="settings-plugin-name"[^>]*href="\/plugins\/example\.notes"[^>]*>便笺<\/a>/
    )
    expect(html).not.toContain('markvault.motion')
    expect(html).not.toContain('全实例功能开关')
    expect(render(<CustomPluginsSection />, { plugins: [plugin('motion')] })).toContain(
      zh.custom.none
    )
    const admin = render(<CustomPluginsSection />, { plugins, admin: true })
    expect(admin).toContain('全实例功能开关')
    expect(admin).toMatch(/data-plugin-id="markvault\.motion".*?>全实例停用<\/button>/s)
    expect(admin).toMatch(/data-plugin-id="markvault\.ocean".*?管理员已停用.*?>允许实例使用<\/button>/s)
    // 只列内置功能，每项一个操作；第三方插件的实例级操作在它自己的详情页
    expect(admin.match(/class="settings-plugin-action"/g)).toHaveLength(2)
  })
})

describe('插件文案', () => {
  // 复数后缀因语言而异（中文只有一种形式），比较前先去掉
  const keys = (value: object, prefix = ''): string[] =>
    Object.entries(value).flatMap(([key, item]) =>
      typeof item === 'object' && item !== null
        ? keys(item, prefix + key + '.')
        : [prefix + key.replace(/_(zero|one|two|few|many|other)$/, '')]
    )
  it('中文与英文的键集合一致', () => {
    const chinese = [...new Set(keys(zh))].sort()
    const english = [...new Set(keys(en))].sort()
    expect(chinese.filter((key) => !english.includes(key))).toEqual([])
    expect(english.filter((key) => !chinese.includes(key))).toEqual([])
  })
  it('ASCII 主题有摘要与背景选项名称', () => {
    expect(zh.summary.ascii).toBe(
      '终端风格界面：边框、按钮、背景与动画都用 ASCII 字符绘制，带启动序列。'
    )
    expect(en.summary.ascii).toBeTruthy()
    expect(zh.settingsOptions.ascii.background).toEqual({
      field: '字符场',
      rain: '字符雨',
      off: '关闭',
    })
    expect(Object.keys(en.settingsOptions.ascii.background)).toEqual(['field', 'rain', 'off'])
  })
})
