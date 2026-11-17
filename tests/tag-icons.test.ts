import { describe, expect, it } from 'vitest'
import { isValidTagIcon, resolveTagIcon } from '../src/lib/tag-icons'

describe('标签品牌识别', () => {
  it.each([
    [' GitHub ', 'github'],
    ['GIT HUB', 'github'],
    ['Docker', 'docker'],
    ['Node.js', 'nodedotjs'],
    ['nodejs', 'nodedotjs'],
    ['Vue', 'vuedotjs'],
    ['K8s', 'kubernetes'],
    ['Golang', 'go'],
    ['哔哩哔哩', 'bilibili'],
    ['群晖', 'synology'],
  ])('识别 %s', (name, expected) => {
    expect(resolveTagIcon(name)?.kind).toBe('brand')
    expect(resolveTagIcon(name)).toHaveProperty('id', expected)
  })
  it('未知名称和包含品牌字样的普通标签保留勾选框', () => {
    expect(resolveTagIcon('个人收藏')).toBeNull()
    expect(resolveTagIcon('GitHub 的文章')).toBeNull()
  })
  it('显式配置覆盖自动识别，清空后恢复识别', () => {
    expect(resolveTagIcon('GitHub', 'brand:docker')).toHaveProperty('id', 'docker')
    expect(resolveTagIcon('GitHub', 'icon:book')).toHaveProperty('id', 'book')
    expect(resolveTagIcon('GitHub', 'none')).toBeNull()
    expect(resolveTagIcon('GitHub', null)).toHaveProperty('id', 'github')
  })
  it('自定义图片保留来源，损坏的历史配置安全降级', () => {
    expect(resolveTagIcon('工作', 'https://example.com/logo.svg')).toEqual({
      kind: 'image',
      src: 'https://example.com/logo.svg',
    })
    expect(resolveTagIcon('GitHub', 'brand:missing')).toBeNull()
    expect(resolveTagIcon('GitHub', 'javascript:alert(1)')).toBeNull()
  })
})

describe('标签图标输入', () => {
  it.each([
    null,
    'none',
    'brand:github',
    'icon:book',
    'https://example.com/logo.png',
    'http://localhost/logo.svg',
  ])('接受 %s', (value) => expect(isValidTagIcon(value)).toBe(true))
  it.each([
    '',
    false,
    7,
    {},
    'brand:missing',
    'icon:missing',
    'javascript:alert(1)',
    'file:///logo.png',
    '//example.com/logo.png',
    'https://user:password@example.com/logo.png',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/png;base64,!!',
    'data:image/png;base64,YQ',
  ])('拒绝无效配置 %s', (value) => expect(isValidTagIcon(value)).toBe(false))
  it('限制上传图片大小和 URL 长度', () => {
    expect(isValidTagIcon('data:image/png;base64,' + 'A'.repeat(87384))).toBe(false)
    expect(isValidTagIcon('https://example.com/' + 'a'.repeat(2048))).toBe(false)
    expect(isValidTagIcon('data:image/png;base64,aGVsbG8=')).toBe(true)
  })
})
