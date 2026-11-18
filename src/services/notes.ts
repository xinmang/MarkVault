import { apiClient } from '@/lib/api-client'
import type { CreateNoteRequest, Note, NoteTarget, NotesResponse, UpdateNoteRequest } from '@/lib/types'
import { assertData } from './index'

function notesPath(target: Pick<NoteTarget, 'kind' | 'id'>): string {
  return target.kind === 'bookmark'
    ? `/bookmarks/${target.id}/notes`
    : `/tab-groups/items/${target.id}/notes`
}

export const notesService = {
  /** 分页读取备注：置顶在前，其余按时间倒序 */
  async getNotes(target: Pick<NoteTarget, 'kind' | 'id'>, pageCursor?: string, signal?: AbortSignal) {
    const searchParams = new URLSearchParams({ page_size: '50' })
    if (pageCursor) searchParams.set('page_cursor', pageCursor)
    const endpoint = `${notesPath(target)}?${searchParams.toString()}`
    const response = await apiClient.get<NotesResponse>(endpoint, { signal })
    return assertData(response.data, `GET ${notesPath(target)}`)
  },

  async createNote(target: Pick<NoteTarget, 'kind' | 'id'>, data: CreateNoteRequest) {
    const response = await apiClient.post<{ note: Note }>(notesPath(target), data)
    return assertData(response.data, `POST ${notesPath(target)}`).note
  },

  async updateNote(id: string, data: UpdateNoteRequest) {
    const response = await apiClient.patch<{ note: Note }>(`/notes/${id}`, data)
    return assertData(response.data, `PATCH /notes/${id}`).note
  },

  async deleteNote(id: string) {
    await apiClient.delete(`/notes/${id}`)
  },
}
