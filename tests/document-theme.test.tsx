import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PluginContext } from '../src/plugins/context'
import { DocumentTheme } from '../src/components/layout/DocumentTheme'
import { useEffectiveColorTheme } from '../src/hooks/useEffectiveColorTheme'
import { toggleThemeWithTransition } from '../src/lib/theme-transition'
import type { PluginState } from '../shared/plugin-types'

const state = vi.hoisted(() => ({
  theme: 'light',
  colorTheme: 'violet',
  toggleTheme: () => {
    state.theme = state.theme === 'light' ? 'dark' : 'light'
  },
}))
vi.mock('@/stores/themeStore', () => ({
  useThemeStore: Object.assign((selector: (value: typeof state) => unknown) => selector(state), {
    getState: () => state,
  }),
}))
// 本仓库使用无 DOM 的测试环境，执行同步布局效果，检查根节点最终属性。
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useLayoutEffect: (effect: () => void) => effect(),
}))
let attrs: Map<string, string>
beforeEach(() => {
  state.theme = 'light'
  state.colorTheme = 'violet'
  attrs = new Map()
  vi.stubGlobal('document', {
    documentElement: {
      setAttribute: (key: string, value: string) => attrs.set(key, value),
      getAttribute: (key: string) => attrs.get(key),
    },
  })
  vi.stubGlobal('window', {})
})
afterEach(() => vi.unstubAllGlobals())

function render(
  enabled: boolean,
  options: {
    safe?: boolean
    ready?: boolean
    disabled?: boolean
    transition?: boolean
    publicPage?: boolean
  } = {}
) {
  function Page() {
    return <div data-color-theme={useEffectiveColorTheme()} />
  }
  const entry = (id: string, running: boolean): PluginState => ({
    manifest: {
      id,
      version: '1.0.0',
      api: '^1.0.0',
      name: id,
      author: '测试',
      permissions: [],
      contributes: [],
    },
    origin: 'builtin',
    enabled: running,
    disabled: options.disabled ?? false,
    status: running ? 'running' : 'disabled',
    config: {},
    grants: [],
    revision: '1',
  })
  return renderToStaticMarkup(
    <PluginContext.Provider
      value={{
        directory: options.publicPage
          ? undefined
          : {
              plugins: [
                entry('markvault.palettes', enabled),
                entry('markvault.theme-transition', options.transition ?? true),
              ],
              admin: false,
              apiVersion: '1.0.0',
              runtimeAvailable: true,
            },
        safe: options.safe ?? false,
        ready: options.ready ?? true,
        refresh: async () => undefined,
      }}
    >
      <DocumentTheme />
      <Page />
    </PluginContext.Provider>
  )
}

describe('明暗模式与配色插件隔离', () => {
  it.each([true, false])('配色停用后多次切换日夜不会恢复保存的紫色，动画插件=%s', (transition) => {
    for (let i = 0; i < 4; i++) {
      expect(render(false, { transition })).toContain('data-color-theme="default"')
      expect(attrs.get('data-color-theme')).toBe('default')
      expect(attrs.get('data-theme')).toBe(state.theme)
      if (transition) toggleThemeWithTransition()
      else state.toggleTheme()
      expect(state.colorTheme).toBe('violet')
    }
  })
  it('启用、停用、重新启用始终保留用户选择，根节点与页面一致', () => {
    expect(render(true)).toContain('data-color-theme="violet"')
    state.toggleTheme()
    render(true)
    expect(attrs.get('data-color-theme')).toBe('violet')
    render(false)
    expect(attrs.get('data-color-theme')).toBe('default')
    render(true)
    expect(attrs.get('data-color-theme')).toBe('violet')
    state.colorTheme = 'green'
    render(true)
    expect(attrs.get('data-color-theme')).toBe('green')
  })
  it('安全模式回退默认色，离开后恢复；公开页采用浏览器配色', () => {
    render(true, { safe: true })
    expect(attrs.get('data-color-theme')).toBe('default')
    state.toggleTheme()
    render(true, { safe: true })
    expect(attrs.get('data-color-theme')).toBe('default')
    render(true)
    expect(attrs.get('data-color-theme')).toBe('violet')
    render(false)
    render(false, { publicPage: true, ready: false })
    expect(attrs.get('data-color-theme')).toBe('violet')
  })
})
