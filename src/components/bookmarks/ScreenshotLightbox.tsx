import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  Copy,
  Download,
  ExternalLink,
  Image as ImageIcon,
  Trash2,
  X,
} from 'lucide-react'
import type { Bookmark, BookmarkScreenshot } from '@/lib/types'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Z_INDEX } from '@/lib/constants/z-index'
import { useToastStore } from '@/stores/toastStore'
import { useDeleteScreenshot } from '@/hooks/useBookmarks'
import {
  formatScreenshotMeta,
  isLightboxDismissKey,
  screenshotFileName,
  shouldConvertToPng,
  supportsImageClipboard,
} from './shared/screenshot-utils'
import { triggerBlobDownload } from './shared/download'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** webp/jpeg 通过 canvas 转成剪贴板唯一支持的 PNG */
async function convertImageBlobToPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D context is unavailable')
    context.drawImage(bitmap, 0, 0)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (png) => (png ? resolve(png) : reject(new Error('PNG conversion failed'))),
        'image/png'
      )
    })
  } finally {
    bitmap.close()
  }
}

async function fetchScreenshotBlob(url: string): Promise<Blob> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to load screenshot: HTTP ${response.status}`)
  return response.blob()
}

export interface ScreenshotLightboxDialogProps {
  bookmarkId: string
  bookmarkTitle: string
  bookmarkUrl: string
  screenshot: BookmarkScreenshot
  readOnly?: boolean
  onClose: () => void
}

/**
 * 灯箱本体（不含 portal），导出以便在没有 DOM 测试环境时做静态渲染测试。
 */
export function ScreenshotLightboxDialog({
  bookmarkId,
  bookmarkTitle,
  bookmarkUrl,
  screenshot,
  readOnly = false,
  onClose,
}: ScreenshotLightboxDialogProps) {
  const { t } = useTranslation('bookmarks')
  const addToast = useToastStore((state) => state.addToast)
  const deleteScreenshot = useDeleteScreenshot()
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [isCopying, setIsCopying] = useState(false)
  const canCopyImage = supportsImageClipboard()
  const meta = formatScreenshotMeta(screenshot)

  // 打开时把焦点移入弹窗，避免焦点留在背后的卡片上
  useEffect(() => {
    closeButtonRef.current?.focus({ preventScroll: true })
  }, [])

  // 弹窗打开期间锁住背景滚动。
  // ConfirmDialog 关闭时会把 body.overflow 清空，因此确认框状态变化后要重新上锁。
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [confirmOpen])

  // Esc 关闭 + Tab 焦点循环；确认框打开时交给 ConfirmDialog 处理
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (confirmOpen) return

      if (isLightboxDismissKey(event.key)) {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key !== 'Tab') return

      const dialog = dialogRef.current
      if (!dialog) return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [confirmOpen, onClose])

  const handleDownload = useCallback(async () => {
    setIsDownloading(true)
    try {
      const blob = await fetchScreenshotBlob(screenshot.url)
      triggerBlobDownload(blob, screenshotFileName(bookmarkUrl, screenshot))
      addToast('success', t('screenshot.downloadSuccess'))
    } catch (error) {
      console.error('Failed to download screenshot:', error)
      addToast('error', t('screenshot.downloadFailed'))
    } finally {
      setIsDownloading(false)
    }
  }, [addToast, bookmarkUrl, screenshot, t])

  const handleCopy = useCallback(async () => {
    setIsCopying(true)
    try {
      const source = await fetchScreenshotBlob(screenshot.url)
      const png = shouldConvertToPng(source.type || screenshot.mime_type)
        ? await convertImageBlobToPng(source)
        : source
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
      addToast('success', t('screenshot.copySuccess'))
    } catch (error) {
      console.error('Failed to copy screenshot:', error)
      addToast('error', t('screenshot.copyFailed'))
    } finally {
      setIsCopying(false)
    }
  }, [addToast, screenshot, t])

  const handleConfirmDelete = useCallback(async () => {
    setConfirmOpen(false)
    try {
      await deleteScreenshot.mutateAsync(bookmarkId)
      addToast('success', t('screenshot.deleteSuccess'))
      onClose()
    } catch (error) {
      console.error('Failed to delete screenshot:', error)
      addToast('error', t('screenshot.deleteFailed'))
    }
  }, [addToast, bookmarkId, deleteScreenshot, onClose, t])

  // portal 里的事件仍会沿 React 树冒泡到触发它的卡片，这里统一截断
  return (
    <>
      <div
        className="vibehub-modal-layer fixed inset-0 flex items-center justify-center p-2 sm:p-4 animate-fade-in"
        style={{ zIndex: Z_INDEX.SNAPSHOT_VIEWER }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="vibehub-modal-backdrop screenshot-lightbox-backdrop absolute inset-0 backdrop-blur-sm"
          onClick={onClose}
          aria-hidden="true"
        />

        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className="vibehub-modal-panel relative card w-full max-w-4xl max-h-[92vh] flex flex-col min-h-0 overflow-hidden shadow-2xl animate-scale-in focus:outline-none"
          style={{ backgroundColor: 'var(--card)' }}
        >
          <header
            className="flex items-start gap-3 p-4 sm:p-5 border-b flex-shrink-0"
            style={{ borderColor: 'var(--border)' }}
          >
            <div className="flex-1 min-w-0">
              <h2
                id={titleId}
                className="text-base sm:text-lg font-bold text-foreground truncate"
                title={bookmarkTitle}
              >
                {bookmarkTitle}
              </h2>
              <p className="text-xs text-muted-foreground mt-1 truncate">{meta}</p>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center text-foreground transition-colors flex-shrink-0"
              aria-label={t('screenshot.close')}
              title={t('screenshot.close')}
            >
              <X className="w-5 h-5" />
            </button>
          </header>

          <div
            className="flex flex-wrap items-center gap-2 px-4 sm:px-5 py-3 border-b flex-shrink-0"
            style={{ borderColor: 'var(--border)' }}
            role="toolbar"
            aria-label={t('screenshot.title')}
          >
            <button
              type="button"
              onClick={handleDownload}
              disabled={isDownloading}
              className="btn btn-sm btn-outline"
            >
              <Download className="w-4 h-4" />
              {t('screenshot.download')}
            </button>

            {canCopyImage && (
              <button
                type="button"
                onClick={handleCopy}
                disabled={isCopying}
                className="btn btn-sm btn-outline"
              >
                <Copy className="w-4 h-4" />
                {isCopying ? t('screenshot.copying') : t('screenshot.copy')}
              </button>
            )}

            <a
              href={bookmarkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-sm btn-outline"
            >
              <ExternalLink className="w-4 h-4" />
              {t('screenshot.openPage')}
            </a>

            <a
              href={screenshot.url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-sm btn-outline"
            >
              <ImageIcon className="w-4 h-4" />
              {t('screenshot.openImage')}
            </a>

            {!readOnly && (
              <button
                type="button"
                onClick={() => setConfirmOpen(true)}
                disabled={deleteScreenshot.isPending}
                className="btn btn-sm btn-outline border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground ml-auto"
              >
                <Trash2 className="w-4 h-4" />
                {t('screenshot.delete')}
              </button>
            )}
          </div>

          <div
            className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 sm:p-6"
            style={{ backgroundColor: 'var(--muted)' }}
          >
            <img
              src={screenshot.url}
              alt={t('screenshot.imageAlt', { title: bookmarkTitle })}
              className="block w-full max-w-[760px] h-auto mx-auto rounded-lg shadow-lg"
              style={{ border: '1px solid var(--border)' }}
              decoding="async"
            />
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmOpen}
        title={t('screenshot.deleteTitle')}
        message={t('screenshot.deleteMessage')}
        type="warning"
        confirmText={t('screenshot.delete')}
        cancelText={t('form.cancel')}
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  )
}

interface ScreenshotLightboxProps {
  bookmark: Bookmark | null
  readOnly?: boolean
  onClose: () => void
}

/**
 * 通过 portal 渲染到 body 的网站截图灯箱；关闭时返回 null。
 * 焦点由 useScreenshotLightbox 在打开/关闭时负责移入与归还。
 */
export function ScreenshotLightbox({ bookmark, readOnly = false, onClose }: ScreenshotLightboxProps) {
  if (!bookmark?.screenshot) return null

  return createPortal(
    <ScreenshotLightboxDialog
      bookmarkId={bookmark.id}
      bookmarkTitle={bookmark.title || bookmark.url}
      bookmarkUrl={bookmark.url}
      screenshot={bookmark.screenshot}
      readOnly={readOnly}
      onClose={onClose}
    />,
    document.body
  )
}
