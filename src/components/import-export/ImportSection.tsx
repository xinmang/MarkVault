import { useRef, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2, FileJson, Loader2, Upload, X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { ErrorDisplay } from '@/components/common/ErrorDisplay'
import { ProgressIndicator } from '@/components/common/ProgressIndicator'
import { useAuthStore } from '@/stores/authStore'
import { BOOKMARKS_QUERY_KEY } from '@/hooks/useBookmarks'
import { TAGS_QUERY_KEY } from '@/hooks/useTags'
import {
  TAB_GROUP_DETAIL_QUERY_KEY,
  TAB_GROUPS_QUERY_KEY,
  TAB_GROUPS_STATISTICS_QUERY_KEY,
  TAB_GROUPS_TRASH_QUERY_KEY,
} from '@/hooks/useTabGroupsQuery'
import {
  DEFAULT_IMPORT_OPTIONS,
  type ImportFilePreview,
  type ImportOptions,
  type ImportResult,
  type ImportSourceFormat,
} from '@shared/import-export-types'

const MAX_IMPORT_FILE_BYTES = 25 * 1024 * 1024

interface ImportSectionProps {
  showHeading?: boolean
  onImport?: (result: ImportResult) => void
}

interface ImportApiResponse {
  data?: ImportResult
  error?: {
    code?: string
    message?: string
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseImportPreview(content: string): ImportFilePreview {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error('INVALID_JSON')
  }

  if (!isRecord(parsed)) throw new Error('INVALID_STRUCTURE')
  if (parsed.format !== 'markvault' && parsed.format !== 'tmarks') {
    throw new Error('UNSUPPORTED_FORMAT')
  }
  if (!Array.isArray(parsed.bookmarks) || !Array.isArray(parsed.tags)) {
    throw new Error('INVALID_STRUCTURE')
  }
  if (parsed.tab_groups !== undefined && !Array.isArray(parsed.tab_groups)) {
    throw new Error('INVALID_STRUCTURE')
  }

  const groups = Array.isArray(parsed.tab_groups) ? parsed.tab_groups : []
  let groupItems = 0
  let deletedItems = 0

  for (const bookmark of parsed.bookmarks) {
    if (isRecord(bookmark) && typeof bookmark.deleted_at === 'string' && bookmark.deleted_at) {
      deletedItems++
    }
  }
  for (const tag of parsed.tags) {
    if (isRecord(tag) && typeof tag.deleted_at === 'string' && tag.deleted_at) {
      deletedItems++
    }
  }
  for (const group of groups) {
    if (!isRecord(group)) continue
    if (group.is_deleted || (typeof group.deleted_at === 'string' && group.deleted_at)) {
      deletedItems++
    }
    if (Array.isArray(group.items)) groupItems += group.items.length
  }

  return {
    format: parsed.format as ImportSourceFormat,
    version: typeof parsed.version === 'string' && parsed.version ? parsed.version : 'unknown',
    exported_at: typeof parsed.exported_at === 'string' ? parsed.exported_at : undefined,
    total_bookmarks: parsed.bookmarks.length,
    total_tags: parsed.tags.length,
    total_tab_groups: groups.length,
    total_tab_group_items: groupItems,
    deleted_items: deletedItems,
  }
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** unitIndex).toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

export function ImportSection({ onImport, showHeading = true }: ImportSectionProps) {
  const { t } = useTranslation('import')
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [preview, setPreview] = useState<ImportFilePreview | null>(null)
  const [options, setOptions] = useState<ImportOptions>({ ...DEFAULT_IMPORT_OPTIONS })
  const [isImporting, setIsImporting] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [progress, setProgress] = useState<{ current: number; status: string } | null>(null)

  const clearFile = () => {
    setSelectedFile(null)
    setFileContent(null)
    setPreview(null)
    setResult(null)
    setError(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const getFileError = (code: string): string => {
    switch (code) {
      case 'INVALID_JSON':
        return t('import.errors.invalidJson')
      case 'UNSUPPORTED_FORMAT':
        return t('import.errors.unsupportedFormat')
      case 'FILE_TOO_LARGE':
        return t('import.errors.fileTooLarge')
      default:
        return t('import.errors.invalidStructure')
    }
  }

  const loadFile = async (file: File) => {
    setError(null)
    setResult(null)
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      setError(getFileError('FILE_TOO_LARGE'))
      return
    }

    try {
      const content = await file.text()
      const parsedPreview = parseImportPreview(content)
      setSelectedFile(file)
      setFileContent(content)
      setPreview(parsedPreview)
    } catch (loadError) {
      const code = loadError instanceof Error ? loadError.message : 'INVALID_STRUCTURE'
      setError(getFileError(code))
      setSelectedFile(null)
      setFileContent(null)
      setPreview(null)
    }
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) await loadFile(file)
  }

  const requestImport = () => {
    if (!fileContent || !preview) {
      setError(t('import.errors.selectFile'))
      return
    }
    if (!options.import_bookmarks && !options.import_tab_groups) {
      setError(t('import.errors.selectScope'))
      return
    }
    setShowConfirm(true)
  }

  const invalidateImportedData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [BOOKMARKS_QUERY_KEY] }),
      queryClient.invalidateQueries({ queryKey: [TAGS_QUERY_KEY] }),
      queryClient.invalidateQueries({ queryKey: TAB_GROUPS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: TAB_GROUPS_TRASH_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: [TAB_GROUP_DETAIL_QUERY_KEY] }),
      queryClient.invalidateQueries({ queryKey: [TAB_GROUPS_STATISTICS_QUERY_KEY] }),
    ])
  }

  const handleImport = async () => {
    if (!fileContent) return
    setShowConfirm(false)
    setIsImporting(true)
    setError(null)
    setResult(null)
    setProgress({ current: 10, status: t('import.progress.validating') })

    try {
      const params = new URLSearchParams({
        skip_duplicates: options.skip_duplicates.toString(),
        preserve_timestamps: options.preserve_timestamps.toString(),
        include_deleted: options.include_deleted.toString(),
        import_bookmarks: options.import_bookmarks.toString(),
        import_tab_groups: options.import_tab_groups.toString(),
        batch_size: options.batch_size.toString(),
      })
      const token = useAuthStore.getState().accessToken
      setProgress({ current: 35, status: t('import.progress.importing') })

      const response = await fetch(`/api/v1/import?${params.toString()}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: fileContent,
      })
      const payload = (await response.json()) as ImportApiResponse
      if (!response.ok || !payload.data) {
        throw new Error(payload.error?.message || t('import.errors.requestFailed'))
      }

      setProgress({ current: 85, status: t('import.progress.refreshing') })
      await invalidateImportedData()
      setResult(payload.data)
      setProgress({ current: 100, status: t('import.progress.complete') })
      onImport?.(payload.data)
    } catch (importError) {
      setError(
        importError instanceof Error ? importError.message : t('import.errors.requestFailed')
      )
    } finally {
      setIsImporting(false)
      setTimeout(() => setProgress(null), 2000)
    }
  }

  const warningText = (warning: string): string => {
    switch (warning) {
      case 'LEGACY_TMARKS_FORMAT':
        return t('import.warnings.legacyFormat')
      case 'SNAPSHOT_OBJECTS_NOT_IMPORTED':
        return t('import.warnings.snapshotObjects')
      case 'LOCAL_COVER_IMAGES_NOT_IMPORTED':
        return t('import.warnings.localCoverImages')
      case 'SOURCE_DUPLICATE_BOOKMARK_URL':
        return t('import.warnings.sourceDuplicates')
      case 'BOOKMARK_TAG_LIMIT_APPLIED':
        return t('import.warnings.tagLimit')
      case 'MISSING_TAB_GROUP_PARENT':
        return t('import.warnings.missingParent')
      case 'CYCLIC_TAB_GROUP_PARENT':
        return t('import.warnings.cyclicParent')
      case 'ERRORS_TRUNCATED':
        return t('import.warnings.errorsTruncated')
      default:
        return warning
    }
  }

  const confirmMode = options.skip_duplicates
    ? t('import.confirmModeSkip')
    : t('import.confirmModeOverwrite')

  return (
    <div className="space-y-5">
      <ConfirmDialog
        isOpen={showConfirm}
        title={t('import.confirmTitle')}
        message={t('import.confirmMessage', {
          bookmarks: options.import_bookmarks ? (preview?.total_bookmarks ?? 0) : 0,
          groups: options.import_tab_groups ? (preview?.total_tab_groups ?? 0) : 0,
          mode: confirmMode,
        })}
        confirmText={t('import.startImport')}
        type={options.skip_duplicates ? 'info' : 'warning'}
        onConfirm={handleImport}
        onCancel={() => setShowConfirm(false)}
      />

      {showHeading && (
        <div>
          <h3 className="text-base sm:text-lg font-semibold text-foreground">
            {t('import.title')}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">{t('import.description')}</p>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleFileChange}
        disabled={isImporting}
      />

      {!selectedFile ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={isImporting}
          className="settings-file-picker w-full rounded-lg border-2 border-dashed border-border bg-muted/30 p-6 text-center hover:border-primary hover:bg-primary/5 transition-colors disabled:opacity-50"
        >
          <Upload className="h-8 w-8 mx-auto text-primary mb-3" />
          <div className="text-sm font-medium text-foreground">{t('import.selectFile')}</div>
          <div className="text-xs text-muted-foreground mt-1">{t('import.fileHint')}</div>
        </button>
      ) : (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-start gap-3">
            <FileJson className="h-6 w-6 text-primary flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-foreground truncate">{selectedFile.name}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {formatFileSize(selectedFile.size)} · {preview?.format.toUpperCase()} · v
                {preview?.version}
              </div>
            </div>
            <button
              type="button"
              onClick={clearFile}
              disabled={isImporting}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50"
              aria-label={t('import.removeFile')}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {preview && (
        <div className="rounded-lg bg-muted p-3 sm:p-4">
          <h4 className="text-sm font-semibold text-foreground mb-3">{t('import.previewTitle')}</h4>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div>
              <div className="text-lg font-bold text-primary">{preview.total_bookmarks}</div>
              <div className="text-xs text-muted-foreground">{t('import.bookmarkCount')}</div>
            </div>
            <div>
              <div className="text-lg font-bold text-success">{preview.total_tags}</div>
              <div className="text-xs text-muted-foreground">{t('import.tagCount')}</div>
            </div>
            <div>
              <div className="text-lg font-bold text-primary">{preview.total_tab_groups}</div>
              <div className="text-xs text-muted-foreground">{t('import.tabGroupCount')}</div>
            </div>
            <div>
              <div className="text-lg font-bold text-foreground">
                {preview.total_tab_group_items}
              </div>
              <div className="text-xs text-muted-foreground">{t('import.tabGroupItemCount')}</div>
            </div>
            <div>
              <div className="text-lg font-bold text-warning">{preview.deleted_items}</div>
              <div className="text-xs text-muted-foreground">{t('import.deletedCount')}</div>
            </div>
          </div>
          {preview.format === 'tmarks' && (
            <div className="mt-3 flex items-start gap-2 text-xs text-warning">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              <span>{t('import.warnings.legacyFormat')}</span>
            </div>
          )}
        </div>
      )}

      <div
        className="settings-multi-options space-y-3"
        role="group"
        aria-label={t('import.options')}
      >
        <div className="settings-multi-heading text-sm font-medium text-foreground">
          {t('import.options')}
        </div>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={options.import_bookmarks}
            onChange={(event) =>
              setOptions((current) => ({ ...current, import_bookmarks: event.target.checked }))
            }
            disabled={isImporting}
            className="h-4 w-4 text-primary border-border rounded focus:ring-primary"
          />
          <span className="text-sm text-foreground">{t('import.importBookmarks')}</span>
        </label>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={options.import_tab_groups}
            onChange={(event) =>
              setOptions((current) => ({ ...current, import_tab_groups: event.target.checked }))
            }
            disabled={isImporting}
            className="h-4 w-4 text-primary border-border rounded focus:ring-primary"
          />
          <span className="text-sm text-foreground">{t('import.importTabGroups')}</span>
        </label>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={options.skip_duplicates}
            onChange={(event) =>
              setOptions((current) => ({ ...current, skip_duplicates: event.target.checked }))
            }
            disabled={isImporting}
            className="h-4 w-4 text-primary border-border rounded focus:ring-primary"
          />
          <span className="text-sm text-foreground">{t('import.skipDuplicates')}</span>
        </label>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={options.preserve_timestamps}
            onChange={(event) =>
              setOptions((current) => ({ ...current, preserve_timestamps: event.target.checked }))
            }
            disabled={isImporting}
            className="h-4 w-4 text-primary border-border rounded focus:ring-primary"
          />
          <span className="text-sm text-foreground">{t('import.preserveTimestamps')}</span>
        </label>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={options.include_deleted}
            onChange={(event) =>
              setOptions((current) => ({ ...current, include_deleted: event.target.checked }))
            }
            disabled={isImporting}
            className="h-4 w-4 text-primary border-border rounded focus:ring-primary"
          />
          <span className="text-sm text-foreground">{t('import.includeDeleted')}</span>
        </label>
      </div>

      {progress && (
        <ProgressIndicator
          progress={{
            current: progress.current,
            total: 100,
            percentage: progress.current,
            status: progress.status,
          }}
          variant="compact"
          showSpeed={false}
          showETA={false}
        />
      )}

      {error && (
        <ErrorDisplay
          errors={[{ message: error }]}
          title={t('import.failed')}
          dismissible
          onDismiss={() => setError(null)}
        />
      )}

      {result && (
        <div className="rounded-lg border border-success/30 bg-success/5 p-4 space-y-3">
          <div className="flex items-center gap-2 text-success">
            <CheckCircle2 className="h-5 w-5" />
            <h4 className="font-semibold">{t('import.resultTitle')}</h4>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <div className="font-bold text-foreground">{result.bookmarks.created}</div>
              <div className="text-xs text-muted-foreground">
                {t('import.resultBookmarksCreated')}
              </div>
            </div>
            <div>
              <div className="font-bold text-foreground">{result.bookmarks.updated}</div>
              <div className="text-xs text-muted-foreground">
                {t('import.resultBookmarksUpdated')}
              </div>
            </div>
            <div>
              <div className="font-bold text-foreground">{result.tab_groups.created}</div>
              <div className="text-xs text-muted-foreground">{t('import.resultGroupsCreated')}</div>
            </div>
            <div>
              <div className="font-bold text-foreground">
                {result.bookmarks.skipped + result.tab_groups.skipped}
              </div>
              <div className="text-xs text-muted-foreground">{t('import.resultSkipped')}</div>
            </div>
          </div>

          {result.warnings.length > 0 && (
            <ErrorDisplay
              errors={result.warnings.map((warning) => ({
                message: warningText(warning),
                code: warning,
              }))}
              variant="warning"
              title={t('import.warningTitle')}
              dismissible={false}
            />
          )}
          {result.errors.length > 0 && (
            <ErrorDisplay
              errors={result.errors.map((item) => ({
                message: `${item.title ? `${item.title}: ` : ''}${item.error}`,
                code: item.code,
              }))}
              title={t('import.partialErrors')}
              dismissible={false}
              showDetails
            />
          )}
        </div>
      )}

      <button
        type="button"
        onClick={requestImport}
        disabled={!selectedFile || isImporting}
        className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-3 sm:py-2 text-sm font-medium text-primary-foreground bg-primary rounded-md hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isImporting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Upload className="h-4 w-4" />
        )}
        <span>{isImporting ? t('import.importing') : t('import.startImport')}</span>
      </button>
    </div>
  )
}
