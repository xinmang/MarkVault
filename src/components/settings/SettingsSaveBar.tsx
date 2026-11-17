/**
 * 设置保存栏
 * 有未保存的变更时固定显示，手机端避开底部导航。
 */

import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { Save, RotateCcw } from 'lucide-react'

interface SettingsSaveBarProps {
  compact?: boolean
  isDirty: boolean
  isSaving: boolean
  onSave: () => void
  onDiscard: () => void
}

export function SettingsSaveBar({
  compact = false,
  isDirty,
  isSaving,
  onSave,
  onDiscard,
}: SettingsSaveBarProps) {
  const { t } = useTranslation('settings')

  if (!isDirty) return null

  return (
    <>
      <div className="h-32 sm:h-24" aria-hidden="true" />
      {createPortal(
        <div
          data-management-theme={compact ? 'default' : undefined}
          className="settings-save-bar fixed inset-x-4 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 mx-auto max-w-5xl overflow-hidden rounded-xl border border-border shadow-lg sm:inset-x-6 sm:bottom-4 animate-in slide-in-from-bottom duration-300"
        >
          <div className="bg-card/95 backdrop-blur-sm border-t border-border px-4 py-3 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-sm text-muted-foreground">{t('message.unsavedChanges')}</span>
            <div className="flex justify-end gap-2">
              <button
                onClick={onDiscard}
                disabled={isSaving}
                className="btn btn-ghost btn-sm min-h-11 flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {t('action.discard')}
              </button>
              <button
                onClick={onSave}
                disabled={isSaving}
                className="btn btn-primary btn-sm min-h-11 flex items-center gap-1.5"
              >
                <Save className="w-3.5 h-3.5" />
                {isSaving ? t('action.saving') : t('action.save')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
