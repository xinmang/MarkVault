import type { Note } from './note.types'

export interface Tag {
  id: string
  user_id?: string
  name: string
  color: string | null
  icon?: string | null
  bookmark_count?: number
  click_count?: number
  last_clicked_at?: string | null
  created_at?: string
  updated_at?: string
}

/**
 * 浏览器插件生成的“网站截图”：只包含正文文字与图片，不含评论和页面框架。
 * url 是后端每次列表/详情返回时重新签发的相对地址，有效期不少于 1 小时。
 */
export interface BookmarkScreenshot {
  id: string
  url: string
  width: number
  height: number
  file_size: number
  mime_type: string
  created_at: string
}

export interface Bookmark {
  id: string
  user_id: string
  title: string
  url: string
  description: string | null
  cover_image: string | null
  favicon: string | null
  is_pinned: boolean
  is_archived: boolean
  is_public: boolean
  click_count: number
  last_clicked_at: string | null
  has_snapshot: boolean
  latest_snapshot_at: string | null
  snapshot_count?: number
  /** 旧服务端或旧缓存可能没有该字段，undefined 与 null 等价 */
  screenshot?: BookmarkScreenshot | null
  ai_summary?: string | null
  /** 备注预览：置顶在前、最多 3 条，过长内容被截断；详情接口返回完整备注 */
  notes?: Note[]
  /** 备注总数；公开分享页和旧缓存没有该字段 */
  note_count?: number
  created_at: string
  updated_at: string
  deleted_at?: string | null
  tags: Tag[]
}

export interface CreateBookmarkRequest {
  title: string
  url: string
  description?: string
  cover_image?: string
  favicon?: string
  tag_ids?: string[]
  is_pinned?: boolean
  is_archived?: boolean
  is_public?: boolean
}

export interface UpdateBookmarkRequest {
  title?: string
  url?: string
  description?: string | null
  cover_image?: string | null
  favicon?: string | null
  tag_ids?: string[]
  is_pinned?: boolean
  is_archived?: boolean
  is_public?: boolean
}

export interface BookmarksResponse {
  bookmarks: Bookmark[]
  meta: {
    page_size: number
    count: number
    next_cursor?: string
    has_more: boolean
    related_tag_ids?: string[]
  }
}

export interface CreateTagRequest {
  name: string
  icon?: string | null
  color?: string
}

export interface UpdateTagRequest {
  name?: string
  icon?: string | null
  color?: string | null
}

export interface TagsResponse {
  tags: Tag[]
}

export interface BookmarkQueryParams {
  keyword?: string
  tags?: string
  page_size?: number
  page_cursor?: string
  sort?: 'created' | 'updated' | 'pinned' | 'popular'
  archived?: boolean
  pinned?: boolean
  public?: boolean
}

export interface TagQueryParams {
  sort?: 'usage' | 'name' | 'clicks'
}

export type BatchActionType = 'delete' | 'update_tags' | 'pin' | 'unpin' | 'archive' | 'unarchive'

export interface BatchActionRequest {
  action: BatchActionType
  bookmark_ids: string[]
  add_tag_ids?: string[]
  remove_tag_ids?: string[]
}

export interface BatchActionResponse {
  success: boolean
  affected_count: number
  errors?: Array<{ bookmark_id: string; message: string }>
}
