import type { PluginState } from '@shared/plugin-types'

/**
 * 仓库约定用「中文 / English」书写双语文本（插件名、Schema 的 title 与 description）。
 * 恰好两段时按界面语言取其中一段，其余写法原样返回。
 */
export function localizedText(text: string, language: string): string {
  const parts = text.split(' / ')
  if (parts.length !== 2) return text
  const [chinese, english] = parts.map((part) => part.trim())
  if (!chinese || !english) return text
  // 界面只有中文和英文两种语言，非英文环境回退到中文，与 i18n 的 fallbackLng 一致
  return language.toLowerCase().startsWith('en') ? english : chinese
}

/** 内置插件的文案键不带 markvault. 前缀。 */
export function pluginShortId(id: string): string {
  return id.startsWith('markvault.') ? id.slice('markvault.'.length) : id
}

export function pluginDisplayName(plugin: PluginState, language: string): string {
  return localizedText(plugin.manifest.name, language)
}
