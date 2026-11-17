import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { useTagFiltering } from '../src/components/tags/useTagFiltering'
import type { Bookmark, Tag } from '../src/lib/types'

const tags: Tag[] = [
  { id: 'windows', name: 'Windows', color: null },
  { id: 'linux', name: 'Linux', color: null },
  { id: 'tools', name: '工具', color: null },
  { id: 'docs', name: '文档', color: null },
]

function bookmark(...tagIds: string[]): Bookmark {
  return { id: tagIds.join('-'), tags: tags.filter((tag) => tagIds.includes(tag.id)) } as Bookmark
}

function filter(bookmarks: Bookmark[], selected: string[], related?: string[], search = '') {
  let result: ReturnType<typeof useTagFiltering> | undefined
  function Probe() {
    result = useTagFiltering(tags, bookmarks, selected, search, related)
    return null
  }
  renderToStaticMarkup(createElement(Probe))
  return result!
}

describe('待选标签与书签交集一致', () => {
  it('后续分页才出现的 Linux 仍按后端结果标记为待选', () => {
    const result = filter([bookmark('tools', 'windows')], ['tools'], ['linux', 'windows'])
    expect([...result.relatedTagIds]).toEqual(['linux', 'windows'])
    expect(result.orderedTags.map((tag) => tag.id)).toEqual(['tools', 'windows', 'linux', 'docs'])
  })

  it('后端明确返回空数组时，不从旧页面书签恢复候选', () => {
    expect(filter([bookmark('tools', 'linux')], ['tools'], []).relatedTagIds.size).toBe(0)
  })

  it('已选标签不会再次成为待选标签', () => {
    expect([...filter([], ['tools'], ['tools', 'linux']).relatedTagIds]).toEqual(['linux'])
  })

  it('多标签分别共现但不存在共同书签时，不误标文档', () => {
    const bookmarks = [bookmark('tools', 'linux'), bookmark('tools', 'docs'), bookmark('linux', 'docs')]
    expect(filter(bookmarks, ['tools', 'linux']).relatedTagIds.size).toBe(0)
  })

  it('降级计算只采纳同时包含全部已选标签的书签', () => {
    const bookmarks = [bookmark('tools', 'linux', 'docs'), bookmark('tools', 'windows')]
    expect([...filter(bookmarks, ['tools', 'linux']).relatedTagIds]).toEqual(['docs'])
    expect([...filter(bookmarks, ['tools']).relatedTagIds].sort()).toEqual(['docs', 'linux', 'windows'])
  })

  it('无选择时不标记候选，标签搜索保留候选状态', () => {
    expect(filter([bookmark('tools', 'linux')], [], ['linux']).relatedTagIds.size).toBe(0)
    const result = filter([], ['tools'], ['linux'], 'LINUX')
    expect(result.orderedTags.map((tag) => tag.id)).toEqual(['linux'])
    expect(result.relatedTagIds.has('linux')).toBe(true)
  })
})
