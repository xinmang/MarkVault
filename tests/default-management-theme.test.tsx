import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PluginContext } from '../src/plugins/context'
import { useDefaultManagementTheme } from '../src/components/settings/useDefaultManagementTheme'
import type { PluginState } from '../shared/plugin-types'

function Probe() {
  return <div data-compact={useDefaultManagementTheme()} />
}

function plugin(
  id: string,
  status: PluginState['status'] = 'running',
  origin: PluginState['origin'] = 'builtin'
): PluginState {
  return {
    manifest: {
      id,
      name: id,
      version: '1.0.0',
      api: '^1.0.0',
      author: '测试',
      permissions: [],
      contributes: [{ id: 'theme', kind: 'theme', title: '主题' }],
    },
    origin,
    enabled: status === 'running',
    disabled: false,
    status,
    config: {},
    grants: [],
    revision: '1',
  }
}

function render(plugins: PluginState[], ready = true, safe = false) {
  return renderToStaticMarkup(
    <PluginContext.Provider
      value={{
        directory: ready
          ? { plugins, admin: false, apiVersion: '1.0.0', runtimeAvailable: true }
          : undefined,
        ready,
        safe,
        refresh: async () => undefined,
      }}
    >
      <Probe />
    </PluginContext.Provider>
  )
}

describe('默认管理界面的主题隔离', () => {
  it('停用全部界面主题后使用紧凑界面，配色插件不阻止默认界面', () => {
    expect(
      render(
        ['classic', 'vibehub', 'uiux-pro', 'ascii', 'liquid-glass']
          .map((id) => plugin('markvault.' + id, 'disabled'))
          .concat(plugin('markvault.palettes'))
      )
    ).toContain('data-compact="true"')
  })
  it.each(['classic', 'vibehub', 'uiux-pro', 'ascii', 'liquid-glass'])('启用 %s 时保留插件界面', (id) => {
    expect(render([plugin('markvault.' + id)])).toContain('data-compact="false"')
  })
  it('运行中的第三方主题优先，失败的主题恢复默认界面', () => {
    expect(render([plugin('example.theme', 'running', 'community')])).toContain(
      'data-compact="false"'
    )
    expect(render([plugin('example.theme', 'failed', 'community')])).toContain(
      'data-compact="true"'
    )
  })
  it('目录尚未加载不抢先覆盖主题，安全模式使用默认界面', () => {
    expect(render([], false)).toContain('data-compact="false"')
    expect(render([plugin('markvault.classic')], true, true)).toContain('data-compact="true"')
  })
})
