import type { Note } from '@/lib/types'
import { NOTE_MAX_LENGTH } from '@/lib/types'

/** 与服务端一致：按 Unicode 字符计数，一个表情或生僻字算一个字符 */
export function noteLength(content: string): number {
  return Array.from(content.trim()).length
}

/** 内容非空且不超过上限时才能提交 */
export function canSubmitNote(content: string): boolean {
  const length = noteLength(content)
  return length > 0 && length <= NOTE_MAX_LENGTH
}

/** 单行预览：折叠换行和连续空白，截断的内容补上省略号 */
export function notePreviewText(note: Pick<Note, 'content' | 'truncated'>): string {
  const text = note.content.replace(/\s+/g, ' ').trim()
  return note.truncated && !text.endsWith('…') ? `${text}…` : text
}

/** 内容被修改过：服务端只在内容变化时更新 updated_at，切换置顶不算 */
export function isNoteEdited(note: Pick<Note, 'created_at' | 'updated_at'>): boolean {
  return !!note.updated_at && note.updated_at !== note.created_at
}

/** 列表上的数量徽标，超过 99 显示 99+ */
export function noteCountLabel(count: number): string {
  return count > 99 ? '99+' : String(count)
}

/** 搜索用：把预览里的备注内容拼进可检索字段 */
export function noteSearchText(notes: Pick<Note, 'content'>[] | undefined): string {
  return (notes ?? []).map((note) => note.content).join('\n')
}
