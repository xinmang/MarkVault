import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { validatePluginManifest, safePluginPath } from '../shared/plugin-manifest'
const fixtures = JSON.parse(
  readFileSync(new URL('../shared/plugin-contract-fixtures.json', import.meta.url), 'utf8')
) as { name: string; valid: boolean; manifest: unknown }[]
describe('插件共享契约', () => {
  for (const fixture of fixtures)
    it(fixture.name, () => expect(validatePluginManifest(fixture.manifest)).toBe(fixture.valid))
  it('拒绝跨平台不安全路径', () => {
    for (const path of ['../a', '/a', 'C:/a', 'a\\b', 'a/../b', 'CON', 'aux.txt', 'a.', 'a//b'])
      expect(safePluginPath(path)).toBe(false)
    expect(safePluginPath('assets/page.html')).toBe(true)
  })
})
