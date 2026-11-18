import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { notesService } from '@/services/notes'
import type { CreateNoteRequest, NoteTarget, UpdateNoteRequest } from '@/lib/types'
import { BOOKMARKS_QUERY_KEY } from './useBookmarks'
import { useInvalidateTabGroups } from './useTabGroupsQuery'

export const NOTES_QUERY_KEY = 'notes'

type TargetRef = Pick<NoteTarget, 'kind' | 'id'>

/** 读取一个书签或标签页的备注。弹窗打开时才发请求，每次打开都重新拉取，保证看到 Agent 刚写入的记录。 */
export function useNotes(target: TargetRef) {
  return useInfiniteQuery({
    queryKey: [NOTES_QUERY_KEY, target.kind, target.id],
    queryFn: ({ pageParam, signal }) => notesService.getNotes(target, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => (lastPage.meta.has_more ? lastPage.meta.next_cursor : undefined),
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
  })
}

/** 备注的新增、修改和删除。成功后刷新备注列表，以及列表页里的备注预览和数量。 */
export function useNoteMutations(target: TargetRef) {
  const queryClient = useQueryClient()
  const invalidateTabGroups = useInvalidateTabGroups()

  const refresh = async () => {
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [NOTES_QUERY_KEY, target.kind, target.id] }),
        target.kind === 'bookmark'
          ? queryClient.invalidateQueries({ queryKey: [BOOKMARKS_QUERY_KEY] })
          : invalidateTabGroups(),
      ])
    } catch (error) {
      console.error('Failed to refresh notes:', error)
    }
  }

  const create = useMutation({
    // 请求成功但响应丢失时，自动重试会把同一次签到记成两条。
    retry: false,
    mutationFn: (data: CreateNoteRequest) => notesService.createNote(target, data),
    onSuccess: refresh,
  })
  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateNoteRequest }) => notesService.updateNote(id, data),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: (id: string) => notesService.deleteNote(id),
    onSuccess: refresh,
  })

  return { create, update, remove }
}
