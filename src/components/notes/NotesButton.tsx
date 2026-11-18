import { useTranslation } from 'react-i18next'
import { NotebookPen } from 'lucide-react'
import type { Note, NoteTarget } from '@/lib/types'
import { useNotesStore } from '@/stores/notesStore'
import { noteCountLabel, notePreviewText } from './note-utils'

interface NotesButtonProps {
  target: NoteTarget
  /** 备注数量；为 0 时按钮平时隐藏，鼠标移到所在卡片上才出现 */
  count?: number
  /** icon：与截图、快照同款的小图标；chip：卡片封面上的文字胶囊 */
  variant?: 'icon' | 'chip'
  className?: string
  iconClassName?: string
}

function useNotesLabel(count: number) {
  const { t } = useTranslation('common')
  return count > 0 ? t('notes.view', { total: count }) : t('notes.add')
}

/** 打开备注弹窗的入口按钮。弹窗本身由应用根部的 NotesDialogHost 渲染。 */
export function NotesButton({
  target,
  count = 0,
  variant = 'icon',
  className = '',
  iconClassName = 'w-3.5 h-3.5',
}: NotesButtonProps) {
  const { t } = useTranslation('common')
  const open = useNotesStore((state) => state.open)
  const label = useNotesLabel(count)
  const emptyClass = count > 0 ? '' : 'notes-button--empty'

  const handleClick = (event: React.MouseEvent) => {
    // 按钮常嵌在整块可点击的书签卡片里，不能触发打开网页
    event.preventDefault()
    event.stopPropagation()
    open(target)
  }

  if (variant === 'chip') {
    return (
      <button
        type="button"
        onClick={handleClick}
        onKeyDown={(event) => event.stopPropagation()}
        className={`bookmark-media-chip ${emptyClass} inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium shadow-sm hover:scale-105 active:scale-95 transition ${className}`}
        title={label}
        aria-label={label}
      >
        <NotebookPen className="w-3 h-3" strokeWidth={2} />
        {t('notes.title')}
        {count > 0 && <span className="opacity-70 tabular-nums">{noteCountLabel(count)}</span>}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      onKeyDown={(event) => event.stopPropagation()}
      className={`bookmark-screenshot-button ${emptyClass} relative inline-flex items-center justify-center rounded-md transition ${className}`}
      title={label}
      aria-label={label}
    >
      <NotebookPen className={iconClassName} strokeWidth={2} />
      {count > 0 && (
        <span className="bookmark-media-count absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full text-[9px] leading-[14px] font-semibold tabular-nums text-center">
          {noteCountLabel(count)}
        </span>
      )}
    </button>
  )
}

interface NotesPreviewProps {
  target: NoteTarget
  /** 列表接口返回的备注预览，第一条是最该先看到的（置顶在前，其余按时间倒序） */
  notes?: Note[]
  count?: number
  className?: string
}

/** 一行备注预览：展示最靠前的一条，其余用 +N 表示；点击打开完整备注。没有备注时不渲染。 */
export function NotesPreview({ target, notes, count = 0, className = '' }: NotesPreviewProps) {
  const open = useNotesStore((state) => state.open)
  const label = useNotesLabel(count)
  const first = notes?.[0]
  if (!first || count <= 0) return null

  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        open(target)
      }}
      onKeyDown={(event) => event.stopPropagation()}
      className={`notes-preview pointer-events-auto flex items-center gap-1.5 w-full min-w-0 text-left text-xs rounded-md px-2 py-1 transition-colors ${className}`}
      title={label}
      aria-label={label}
    >
      <NotebookPen className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={2} />
      <span className="truncate min-w-0 flex-1">{notePreviewText(first)}</span>
      {count > 1 && <span className="notes-preview__more flex-shrink-0 tabular-nums">+{noteCountLabel(count - 1)}</span>}
    </button>
  )
}
