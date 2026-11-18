/**
 * 备注：对书签或标签页所指网站的评价与记录（是否需要登录、反爬情况、签到结果等）。
 * 与描述不同，一条记录可以有多条备注，Agent 也能读取和追加。
 */
export interface Note {
  id: string
  bookmark_id?: string
  tab_item_id?: string
  content: string
  /** user：本人通过登录会话添加；agent：API Key、MCP 或站内助手写入 */
  source: 'user' | 'agent'
  /** 写入时的 API Key 名称，本人和站内助手为空 */
  source_name: string
  is_pinned: boolean
  created_at: string
  updated_at: string
  /** 列表预览里的内容被截断时为 true，完整内容通过备注列表接口读取 */
  truncated?: boolean
}

/** 备注挂在哪条记录上 */
export interface NoteTarget {
  kind: 'bookmark' | 'tab'
  id: string
  /** 弹窗标题里展示的书签或标签页标题 */
  title: string
}

export interface NotesResponse {
  notes: Note[]
  meta: {
    page_size: number
    count: number
    total: number
    has_more: boolean
    next_cursor?: string
  }
}

export interface CreateNoteRequest {
  content: string
  is_pinned?: boolean
}

export interface UpdateNoteRequest {
  content?: string
  is_pinned?: boolean
}

/** 单条备注的最大字符数，与服务端 maxNoteRunes 保持一致 */
export const NOTE_MAX_LENGTH = 2000
