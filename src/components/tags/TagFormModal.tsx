import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Z_INDEX } from '@/lib/constants/z-index'
import { isValidTagIcon } from '@/lib/tag-icons'
import { TagIconPicker } from './TagIconPicker'

interface TagFormModalProps {
  isOpen: boolean
  title: string
  initialName: string
  initialIcon?: string | null
  onConfirm: (name: string, icon: string | null) => void
  onCancel: () => void
  confirmLabel?: string
  isSubmitting?: boolean
  onDelete?: () => void
  isDeleting?: boolean
}

export function TagFormModal(props: TagFormModalProps) {
  if (!props.isOpen) return null
  return <TagFormDialog {...props} />
}

function TagFormDialog({
  isOpen,
  title,
  initialName,
  initialIcon = null,
  onConfirm,
  onCancel,
  confirmLabel,
  isSubmitting = false,
  onDelete,
  isDeleting = false,
}: TagFormModalProps) {
  const { t } = useTranslation('tags')
  const { t: tc } = useTranslation('common')
  const [name, setName] = useState(initialName)
  const [icon, setIcon] = useState<string | null>(initialIcon)
  const busy = isSubmitting || isDeleting
  const [previousFocus] = useState(() => document.activeElement as HTMLElement | null)

  useEffect(() => {
    if (isOpen) {
      setName(initialName)
      setIcon(initialIcon)
    }
  }, [initialName, initialIcon, isOpen])

  useEffect(() => {
    if (!isOpen) return
    return () => previousFocus?.focus()
  }, [isOpen, previousFocus])

  if (!isOpen) return null

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: Z_INDEX.TAG_FORM_MODAL }}
    >
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={() => {
          if (!busy) onCancel()
        }}
      />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="tag-form-title"
        className="relative max-h-[90dvh] w-full max-w-md space-y-4 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault()
          if (name.trim() && isValidTagIcon(icon) && !busy) onConfirm(name.trim(), icon)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) {
            event.stopPropagation()
            onCancel()
          }
          if (event.key === 'Tab') {
            const fields = [
              ...event.currentTarget.querySelectorAll<HTMLElement>(
                'input:not([disabled]),select:not([disabled]),button:not([disabled])'
              ),
            ]
            const first = fields[0],
              last = fields[fields.length - 1]
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault()
              last?.focus()
            }
            if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault()
              first?.focus()
            }
          }
        }}
      >
        <h3 id="tag-form-title" className="text-base font-semibold">
          {title}
        </h3>
        <div className="space-y-1.5">
          <label htmlFor="tag-name" className="text-sm font-medium">
            {t('form.nameLabel')}
          </label>
          <input
            id="tag-name"
            type="text"
            className="input min-h-11 w-full"
            value={name}
            maxLength={50}
            required
            onChange={(event) => setName(event.target.value)}
            placeholder={t('form.namePlaceholder')}
            disabled={busy}
            autoFocus
          />
        </div>
        <TagIconPicker
          key={initialName + String(initialIcon)}
          name={name}
          value={icon}
          onChange={setIcon}
          disabled={busy}
        />
        <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
          {onDelete ? (
            <button
              type="button"
              className="btn btn-sm btn-error min-h-11"
              onClick={onDelete}
              disabled={busy}
            >
              {isDeleting ? t('action.deleting') : t('action.delete')}
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-sm btn-outline min-h-11"
              onClick={onCancel}
              disabled={busy}
            >
              {tc('button.cancel')}
            </button>
            <button
              type="submit"
              className="btn btn-sm min-h-11"
              disabled={!name.trim() || !isValidTagIcon(icon) || busy}
            >
              {isSubmitting ? t('action.saving') : (confirmLabel ?? t('action.save'))}
            </button>
          </div>
        </div>
      </form>
    </div>,
    document.body
  )
}
