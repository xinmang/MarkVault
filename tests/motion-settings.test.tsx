import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { OceanBackgroundSettings } from '../src/components/settings/tabs/MotionSettingsTab'
import type { AppearancePreview } from '../src/contexts/ExperimentalFeaturesContext'
import zh from '../src/i18n/locales/zh-CN/settings.json'
import en from '../src/i18n/locales/en/settings.json'

const state = vi.hoisted(() => ({ oceanBackground: 'dolphins', setOceanBackground: vi.fn() }))
vi.mock('@/stores/themeStore', () => ({ useThemeStore: () => state }))
vi.mock('@/contexts/ExperimentalFeaturesContext', () => ({
  useExperimentalFeatures: () => ({ motion: { reducedMotion: false } }),
}))
const i18n = createInstance()
beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'zh-CN',
    resources: { 'zh-CN': { settings: zh }, en: { settings: en } },
    interpolation: { escapeValue: false },
  })
})

const value: AppearancePreview = {
  motion_enabled: true,
  ocean_background_scope: 'account',
  ocean_background: 'sharks',
}
function render(updates: Partial<AppearancePreview> = {}) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <OceanBackgroundSettings value={{ ...value, ...updates }} onChange={() => undefined} />
    </I18nextProvider>
  )
}

describe('插件内的海洋背景设置', () => {
  it('配置面板不重复提供插件总开关，保留海洋配置', () => {
    const html = render()
    expect(html).not.toContain('type="checkbox"')
    expect(html).not.toContain('type="range"')
    for (const removed of [
      '动画速度',
      '动效强度',
      '按钮反馈',
      '卡片悬停',
      '列表入场',
      '实时预览',
      '重播入场',
    ]) {
      expect(html).not.toContain(removed)
    }
    expect(html).toContain('保存到账号')
    expect(html).toContain('跟随浏览器')
  })

  it('账号与浏览器模式显示各自的选择，关闭动效仍可选静态海洋', () => {
    expect(render()).toMatch(/aria-pressed="true"[^>]*>鲨鱼<\/button>/)
    expect(render({ ocean_background_scope: 'browser' })).toMatch(
      /aria-pressed="true"[^>]*>海豚<\/button>/
    )
    const disabled = render({ motion_enabled: false })
    expect(disabled).toContain(zh.motion.ocean.paused)
    expect(disabled).not.toContain('disabled=""')
  })

  it('英文界面使用相同的内嵌选项，不重复启停开关', async () => {
    await i18n.changeLanguage('en')
    try {
      const html = render()
      expect(html).toContain(en.motion.ocean.scopes.account)
      expect(html).toContain(en.motion.ocean.scopes.browser)
      expect(html).not.toContain('type="checkbox"')
    } finally {
      await i18n.changeLanguage('zh-CN')
    }
  })
})
