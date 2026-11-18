import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Bot, Check, Loader2, NotebookPen, Pencil, Pin, PinOff, Trash2, User, X } from 'lucide-react'
import { ApiError } from '@/lib/api-client'
import { Z_INDEX } from '@/lib/constants/z-index'
import { NOTE_MAX_LENGTH, type Note, type NoteTarget } from '@/lib/types'
import { useNoteMutations, useNotes } from '@/hooks/useNotes'
import { useNotesStore } from '@/stores/notesStore'
import { useToastStore } from '@/stores/toastStore'
import { formatScreenshotTime } from '@/components/bookmarks/shared/screenshot-utils'
import { canSubmitNote, isNoteEdited, noteLength } from './note-utils'

/** 挂在应用根部：有目标时把备注弹窗渲染到 body */
export function NotesDialogHost() {
  const target = useNotesStore((state) => state.target)
  const close = useNotesStore((state) => state.close)
  if (!target) return null
  return createPortal(
    <NotesDialog key={`${target.kind}:${target.id}`} target={target} onClose={close} />,
    document.body
  )
}

interface NotesDialogProps {
  target: NoteTarget
  onClose: () => void
}

/** 服务端对内容和数量上限的拒绝原因直接展示，其余错误用通用提示 */
function failureMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError && error.status === 400 && error.message ? error.message : fallback
}

export function NotesDialog({ target, onClose }: NotesDialogProps) {
  const { t } = useTranslation('common')
  const addToast = useToastStore((state) => state.addToast)
  const titleId = useId()
  const draftRef = useRef<HTMLTextAreaElement>(null)
  const [draft, setDraft] = useState('')
  const [draftPinned, setDraftPinned] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const query = useNotes(target)
  const { create, update, remove } = useNoteMutations(target)

  // 分页按偏移量取数，中途有新增或删除时相邻两页可能重复，这里按 ID 去重
  const notes = useMemo(() => {
    const seen = new Map<string, Note>()
    for (const page of query.data?.pages ?? []) {
      for (const note of page.notes) if (!seen.has(note.id)) seen.set(note.id, note)
    }
    return Array.from(seen.values())
  }, [query.data])
  const total = query.data?.pages[0]?.meta.total ?? notes.length

  // Esc：先退出正在进行的编辑或删除确认，再关闭弹窗；同时锁住背景滚动
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      if (editingId) setEditingId(null)
      else if (confirmDeleteId) setConfirmDeleteId(null)
      else onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [confirmDeleteId, editingId, onClose])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    draftRef.current?.focus({ preventScroll: true })
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  const handleCreate = async () => {
    if (!canSubmitNote(draft) || create.isPending) return
    try {
      await create.mutateAsync({ content: draft.trim(), is_pinned: draftPinned })
      setDraft('')
      setDraftPinned(false)
      draftRef.current?.focus({ preventScroll: true })
    } catch (error) {
      console.error('Failed to add note:', error)
      addToast('error', failureMessage(error, t('notes.addFailed')))
    }
  }

  const handleTogglePin = async (note: Note) => {
    setBusyId(note.id)
    try {
      await update.mutateAsync({ id: note.id, data: { is_pinned: !note.is_pinned } })
    } catch (error) {
      console.error('Failed to pin note:', error)
      addToast('error', t('notes.updateFailed'))
    } finally {
      setBusyId(null)
    }
  }

  const startEditing = (note: Note) => {
    setConfirmDeleteId(null)
    setEditingId(note.id)
    setEditingText(note.content)
  }

  const handleSaveEdit = async (note: Note) => {
    if (!canSubmitNote(editingText) || busyId) return
    const content = editingText.trim()
    if (content === note.content) {
      setEditingId(null)
      return
    }
    setBusyId(note.id)
    try {
      await update.mutateAsync({ id: note.id, data: { content } })
      setEditingId(null)
    } catch (error) {
      console.error('Failed to update note:', error)
      addToast('error', failureMessage(error, t('notes.updateFailed')))
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (note: Note) => {
    setBusyId(note.id)
    try {
      await remove.mutateAsync(note.id)
      setConfirmDeleteId(null)
    } catch (error) {
      console.error('Failed to delete note:', error)
      addToast('error', t('notes.deleteFailed'))
    } finally {
      setBusyId(null)
    }
  }

  const sourceLabel = (note: Note) => {
    if (note.source !== 'agent') return t('notes.sourceUser')
    return note.source_name ? t('notes.sourceAgent', { name: note.source_name }) : t('notes.sourceAssistant')
  }

  const draftLength = noteLength(draft)

  return (
    <div
      className="vibehub-modal-layer fixed inset-0 flex items-center justify-center p-2 sm:p-4 animate-fade-in"
      style={{ zIndex: Z_INDEX.NOTES_DIALOG }}
    >
      <div
        className="vibehub-modal-backdrop screenshot-lightbox-backdrop absolute inset-0 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="vibehub-modal-panel notes-dialog relative card w-full max-w-2xl max-h-[88vh] flex flex-col min-h-0 overflow-hidden shadow-2xl animate-scale-in"
        style={{ backgroundColor: 'var(--card)', padding: 0 }}
      >
        <header className="notes-dialog__section flex items-start gap-3 p-4 sm:p-5 flex-shrink-0">
          <NotebookPen className="notes-dialog__accent w-5 h-5 mt-0.5 flex-shrink-0" strokeWidth={2} />
          <div className="flex-1 min-w-0">
            <h2 id={titleId} className="text-base sm:text-lg font-bold leading-tight">
              {t('notes.title')}
            </h2>
            <p className="notes-dialog__muted text-xs mt-1 truncate" title={target.title}>
              {target.title}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="notes-dialog__icon-button w-8 h-8 flex-shrink-0"
            aria-label={t('button.close')}
            title={t('button.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        <form
          className="notes-dialog__section p-4 sm:p-5 flex flex-col gap-2 flex-shrink-0"
          onSubmit={(event) => {
            event.preventDefault()
            void handleCreate()
          }}
        >
          <textarea
            ref={draftRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault()
                void handleCreate()
              }
            }}
            rows={3}
            className="input notes-dialog__textarea"
            placeholder={t('notes.placeholder')}
            aria-label={t('notes.add')}
          />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                className="checkbox"
                checked={draftPinned}
                onChange={(event) => setDraftPinned(event.target.checked)}
              />
              {t('notes.pinOnAdd')}
            </label>
            <span
              className={`text-xs tabular-nums ${draftLength > NOTE_MAX_LENGTH ? 'notes-dialog__danger' : 'notes-dialog__muted'}`}
            >
              {draftLength}/{NOTE_MAX_LENGTH}
            </span>
            <span className="notes-dialog__muted hidden sm:inline text-xs">{t('notes.shortcut')}</span>
            <button
              type="submit"
              className="btn btn-sm btn-primary ml-auto"
              disabled={!canSubmitNote(draft) || create.isPending}
            >
              {create.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {t('notes.add')}
            </button>
          </div>
          <p className="notes-dialog__muted text-xs leading-relaxed">{t('notes.hint')}</p>
        </form>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5">
          {query.isPending ? (
            <div className="notes-dialog__muted flex items-center justify-center gap-2 py-10 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('notes.loading')}
            </div>
          ) : query.isError ? (
            <div className="flex flex-col items-center gap-3 py-10 text-sm">
              <p className="notes-dialog__danger">{t('notes.loadFailed')}</p>
              <button type="button" className="btn btn-sm btn-outline" onClick={() => void query.refetch()}>
                {t('button.retry')}
              </button>
            </div>
          ) : notes.length === 0 ? (
            <div className="notes-dialog__muted flex flex-col items-center text-center py-10">
              <NotebookPen className="w-10 h-10 mb-3 opacity-30" strokeWidth={1.5} />
              <p className="text-sm font-medium">{t('notes.empty')}</p>
              <p className="text-xs mt-1">{t('notes.emptyHint')}</p>
            </div>
          ) : (
            <>
              <p className="notes-dialog__muted text-xs mb-3">{t('notes.total', { total })}</p>
              <ul className="flex flex-col gap-2.5">
                {notes.map((note) => {
                  const isEditing = editingId === note.id
                  const isBusy = busyId === note.id
                  const editedTime = isNoteEdited(note) ? formatScreenshotTime(note.updated_at) : ''
                  return (
                    <li key={note.id} className="notes-item" data-pinned={note.is_pinned ? 'true' : undefined}>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs min-h-7">
                        <span className={`notes-source notes-source--${note.source}`}>
                          {note.source === 'agent' ? <Bot className="w-3 h-3" /> : <User className="w-3 h-3" />}
                          <span className="truncate">{sourceLabel(note)}</span>
                        </span>
                        <time className="notes-dialog__muted tabular-nums" dateTime={note.created_at}>
                          {formatScreenshotTime(note.created_at)}
                        </time>
                        {editedTime && (
                          <span className="notes-dialog__muted" title={t('notes.editedAt', { time: editedTime })}>
                            {t('notes.edited')}
                          </span>
                        )}
                        {note.is_pinned && (
                          <span className="notes-dialog__accent inline-flex items-center gap-0.5 font-medium">
                            <Pin className="w-3 h-3" />
                            {t('notes.pinned')}
                          </span>
                        )}

                        <div className="ml-auto flex items-center gap-0.5">
                          {confirmDeleteId === note.id ? (
                            <>
                              <span className="notes-dialog__danger mr-1">{t('notes.deleteConfirm')}</span>
                              <button
                                type="button"
                                className="btn btn-sm notes-dialog__danger-button"
                                disabled={isBusy}
                                onClick={() => void handleDelete(note)}
                              >
                                {t('button.delete')}
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-ghost"
                                disabled={isBusy}
                                onClick={() => setConfirmDeleteId(null)}
                              >
                                {t('button.cancel')}
                              </button>
                            </>
                          ) : !isEditing ? (
                            <>
                              <button
                                type="button"
                                className="notes-dialog__icon-button w-7 h-7"
                                disabled={isBusy}
                                onClick={() => void handleTogglePin(note)}
                                title={note.is_pinned ? t('notes.unpin') : t('notes.pin')}
                                aria-label={note.is_pinned ? t('notes.unpin') : t('notes.pin')}
                              >
                                {note.is_pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                              </button>
                              <button
                                type="button"
                                className="notes-dialog__icon-button w-7 h-7"
                                disabled={isBusy}
                                onClick={() => startEditing(note)}
                                title={t('button.edit')}
                                aria-label={t('button.edit')}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                className="notes-dialog__icon-button notes-dialog__icon-button--danger w-7 h-7"
                                disabled={isBusy}
                                onClick={() => {
                                  setEditingId(null)
                                  setConfirmDeleteId(note.id)
                                }}
                                title={t('button.delete')}
                                aria-label={t('button.delete')}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          ) : null}
                        </div>
                      </div>

                      {isEditing ? (
                        <div className="flex flex-col gap-2 mt-2">
                          <textarea
                            value={editingText}
                            onChange={(event) => setEditingText(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                                event.preventDefault()
                                void handleSaveEdit(note)
                              }
                            }}
                            rows={Math.min(8, Math.max(3, editingText.split('\n').length))}
                            className="input notes-dialog__textarea"
                            aria-label={t('button.edit')}
                            autoFocus
                          />
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-xs tabular-nums ${noteLength(editingText) > NOTE_MAX_LENGTH ? 'notes-dialog__danger' : 'notes-dialog__muted'}`}
                            >
                              {noteLength(editingText)}/{NOTE_MAX_LENGTH}
                            </span>
                            <button
                              type="button"
                              className="btn btn-sm btn-ghost ml-auto"
                              disabled={isBusy}
                              onClick={() => setEditingId(null)}
                            >
                              {t('button.cancel')}
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              disabled={isBusy || !canSubmitNote(editingText)}
                              onClick={() => void handleSaveEdit(note)}
                            >
                              <Check className="w-4 h-4" />
                              {t('button.save')}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="notes-item__content text-sm leading-relaxed mt-1">{note.content}</p>
                      )}
                    </li>
                  )
                })}
              </ul>

              {query.hasNextPage && (
                <div className="flex justify-center mt-4">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    disabled={query.isFetchingNextPage}
                    onClick={() => void query.fetchNextPage()}
                  >
                    {query.isFetchingNextPage && <Loader2 className="w-4 h-4 animate-spin" />}
                    {t('button.loadMore')}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
