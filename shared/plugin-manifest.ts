import { PLUGIN_CATEGORIES, type PluginManifest } from './plugin-types'

const ids = /^[a-z][a-z0-9-]{1,39}\.[a-z][a-z0-9-]{1,59}$/
const version = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/
const localID = /^[a-z][a-z0-9_-]{0,47}$/
export const pluginPermissions = [
  'storage.read',
  'storage.write',
  'bookmarks.read',
  'bookmarks.write',
  'tags.read',
  'tags.write',
  'network.fetch',
  'models.call',
] as const
export const pluginKinds = [
  'theme',
  'motion',
  'background',
  'page',
  'panel',
  'action',
  'provider',
  'agent',
  'tool',
  'mcp',
] as const
export function safePluginPath(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 240 &&
    !/[\\:\0]/.test(value) &&
    !value.startsWith('/') &&
    value
      .split('/')
      .every(
        (part) =>
          part !== '' &&
          part !== '.' &&
          part !== '..' &&
          !/[. ]$/.test(part) &&
          !/^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)/i.test(part)
      )
  )
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function schemaValid(value: unknown, depth = 0): boolean {
  if (!record(value) || depth > 12) return false
  for (const key of ['minimum', 'maximum', 'minLength', 'maxLength', 'maxItems']) {
    const n = value[key]
    if (
      n !== undefined &&
      (typeof n !== 'number' ||
        !Number.isFinite(n) ||
        (!['minimum', 'maximum'].includes(key) && (!Number.isInteger(n) || n < 0)))
    )
      return false
  }
  if (value.additionalProperties !== undefined && typeof value.additionalProperties !== 'boolean')
    return false
  if (value.enum !== undefined && (!Array.isArray(value.enum) || value.enum.length === 0))
    return false
  if (!['object', 'array', 'string', 'boolean', 'integer', 'number'].includes(String(value.type)))
    return false
  if (
    Object.keys(value).some(
      (key) =>
        ![
          'type',
          'properties',
          'required',
          'additionalProperties',
          'items',
          'enum',
          'title',
          'description',
          'default',
          'minimum',
          'maximum',
          'minLength',
          'maxLength',
          'maxItems',
        ].includes(key)
    )
  )
    return false
  if (
    value.properties !== undefined &&
    (!record(value.properties) ||
      Object.values(value.properties).some((item) => !schemaValid(item, depth + 1)))
  )
    return false
  if (value.items !== undefined && !schemaValid(value.items, depth + 1)) return false
  if (
    value.required !== undefined &&
    (!Array.isArray(value.required) || value.required.some((item) => typeof item !== 'string'))
  )
    return false
  return true
}
/** 前端打包检查与 Go 使用相同契约样例，安装时仍由服务端独立校验。 */
export function validatePluginManifest(value: unknown): value is PluginManifest {
  if (!record(value)) return false
  if (
    Object.keys(value).some(
      (key) =>
        ![
          'id',
          'version',
          'api',
          'name',
          'description',
          'author',
          'category',
          'icon',
          'server',
          'dependencies',
          'permissions',
          'settings',
          'contributes',
        ].includes(key)
    )
  )
    return false
  if (
    !ids.test(String(value.id)) ||
    !version.test(String(value.version)) ||
    !['^1.0.0', '1.0.0'].includes(String(value.api))
  )
    return false
  for (const key of ['name', 'author'])
    if (
      typeof value[key] !== 'string' ||
      !value[key] ||
      new TextEncoder().encode(value[key]).length > 120
    )
      return false
  if (
    value.description !== undefined &&
    (typeof value.description !== 'string' ||
      new TextEncoder().encode(value.description).length > 2000)
  )
    return false
  if (
    value.category !== undefined &&
    !PLUGIN_CATEGORIES.some((category) => category === value.category)
  )
    return false
  if (
    value.icon !== undefined &&
    (typeof value.icon !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(value.icon))
  )
    return false
  if (
    value.server !== undefined &&
    (typeof value.server !== 'string' ||
      !safePluginPath(value.server) ||
      !value.server.endsWith('.js'))
  )
    return false
  if (
    !Array.isArray(value.permissions) ||
    value.permissions.some((p) => !pluginPermissions.includes(p)) ||
    new Set(value.permissions).size !== value.permissions.length
  )
    return false
  if (
    value.dependencies !== undefined &&
    (!record(value.dependencies) ||
      Object.entries(value.dependencies).some(
        ([id, v]) => !ids.test(id) || id === value.id || typeof v !== 'string' || !version.test(v)
      ))
  )
    return false
  if (
    !Array.isArray(value.contributes) ||
    value.contributes.length < 1 ||
    value.contributes.length > 64
  )
    return false
  const seen = new Set<string>()
  for (const c of value.contributes) {
    if (
      !record(c) ||
      Object.keys(c).some(
        (key) =>
          !['id', 'kind', 'title', 'entry', 'slot', 'tokens', 'inputSchema', 'animation'].includes(
            key
          )
      )
    )
      return false
    if (
      typeof c.id !== 'string' ||
      !localID.test(c.id) ||
      seen.has(c.id) ||
      !pluginKinds.some((kind) => kind === c.kind) ||
      typeof c.title !== 'string' ||
      !c.title ||
      new TextEncoder().encode(c.title).length > 120
    )
      return false
    seen.add(c.id)
    if (
      c.kind === 'motion' &&
      (!record(c.animation) ||
        !['cards', 'buttons', 'tags'].includes(String(c.animation.target)) ||
        !['fade', 'rise', 'pulse'].includes(String(c.animation.effect)) ||
        !Number.isInteger(c.animation.duration) ||
        Number(c.animation.duration) < 100 ||
        Number(c.animation.duration) > 2000)
    )
      return false
    if (c.entry !== undefined && (typeof c.entry !== 'string' || !safePluginPath(c.entry)))
      return false
    if (['page', 'panel', 'background', 'action'].includes(String(c.kind)) && !c.entry) return false
    if (['tool', 'agent', 'provider'].includes(String(c.kind)) && !value.server) return false
    if (
      c.tokens !== undefined &&
      (!record(c.tokens) ||
        Object.entries(c.tokens).some(
          ([key, token]) =>
            !/^--[a-z][a-z0-9-]{0,60}$/.test(key) ||
            typeof token !== 'string' ||
            !/^[a-zA-Z0-9#(),.% /-]{1,120}$/.test(token) ||
            /url/i.test(token)
        ))
    )
      return false
    if (c.inputSchema !== undefined && !schemaValid(c.inputSchema)) return false
    if (
      record(c.inputSchema) &&
      record(c.inputSchema.properties) &&
      'confirm' in c.inputSchema.properties
    )
      return false
  }
  return value.settings === undefined || schemaValid(value.settings)
}
