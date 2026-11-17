import { useTranslation } from 'react-i18next'

interface BatchSelectionPromptProps {
  batchMode: boolean
  selectedCount: number
  totalCount: number
  onSelectAll: () => void
  onClearSelection: () => void
}

export function BatchSelectionPrompt({
  batchMode,
  selectedCount,
  totalCount,
  onSelectAll,
  onClearSelection,
}: BatchSelectionPromptProps) {
  const { t } = useTranslation('bookmarks')

  if (!batchMode) return null

  return (
    <div className="flex-shrink-0 px-3 sm:px-4 md:px-6 pt-3 w-full">
      <div className="batch-selection-prompt card w-full">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-0">
          <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-xs sm:text-sm">
            <span className="font-medium text-foreground whitespace-nowrap">
              {selectedCount > 0
                ? t('batch.selectedCount', { count: selectedCount })
                : t('batch.pleaseSelect')}
            </span>
            {selectedCount < totalCount && (
              <>
                <span className="text-border hidden sm:inline">|</span>
                <button
                  onClick={onSelectAll}
                  className="text-primary hover:text-primary/80 transition-colors whitespace-nowrap"
                >
                  {t('batch.selectAll', { count: totalCount })}
                </button>
              </>
            )}
            {selectedCount > 0 && (
              <>
                <span className="text-border hidden sm:inline">|</span>
                <button
                  onClick={onClearSelection}
                  className="text-primary hover:text-primary/80 transition-colors whitespace-nowrap"
                >
                  {t('batch.cancel')}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
