import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Bookmark, NoteTarget } from '../src/lib/types'
import { canSubmitNote, noteLength, notePreviewText } from '../src/components/notes/note-utils'
import { NotesDialog } from '../src/components/notes/NotesDialog'
import { NotesPreview } from '../src/components/notes/NotesButton'
import { InlineNotesButton } from '../plugins/builtin/layouts/shared'

vi.mock('react-i18next', async (original) => ({
  ...(await original<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/hooks/useNotes', () => ({
  useNotes: () => ({ data: { pages: [{ notes: [], meta: { total: 0 } }] } }),
  useNoteMutations: () => ({ create: {}, update: {}, remove: {} }),
}))

const target: NoteTarget = { kind: 'bookmark', id: 'a', title: '签到站' }
const props = { bookmark: { ...target, note_count: 2 } as Bookmark, isSelected: false }

describe('私人备注', () => {
  it('按 Unicode 码点校验正文，不按 UTF-16 长度截断表情', () => {
    expect(noteLength(' 𠮷🙂 ')).toBe(2)
    expect(canSubmitNote(' \n\t')).toBe(false)
    expect(canSubmitNote('🙂'.repeat(2000))).toBe(true)
    expect(canSubmitNote('🙂'.repeat(2001))).toBe(false)
  })

  it('预览折叠换行，仅为截断的内容补一个省略号', () => {
    expect(notePreviewText({ content: ' 签到\n 成功 ' })).toBe('签到 成功')
    expect(notePreviewText({ content: '签到', truncated: true })).toBe('签到…')
    expect(notePreviewText({ content: '签到…', truncated: true })).toBe('签到…')
  })

  it('空列表不占预览位置，弹窗显示空状态，空草稿不能提交', () => {
    expect(renderToStaticMarkup(<NotesPreview target={target} notes={[]} count={0} />)).toBe('')
    const html = renderToStaticMarkup(<NotesDialog target={target} onClose={() => undefined} />)
    expect(html).toContain('notes.empty')
    expect(html).toMatch(/<button[^>]+type="submit"[^>]+disabled/)
  })

  it('只读与批量模式不渲染备注按钮或数量', () => {
    expect(renderToStaticMarkup(<InlineNotesButton {...props} />)).toContain('notes.view')
    expect(renderToStaticMarkup(<InlineNotesButton {...props} readOnly />)).toBe('')
    expect(renderToStaticMarkup(<InlineNotesButton {...props} batchMode />)).toBe('')
  })
})
