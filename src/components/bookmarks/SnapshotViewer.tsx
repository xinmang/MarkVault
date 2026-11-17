import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { Camera, Download, ExternalLink, Globe, Trash2, X } from 'lucide-react';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Z_INDEX } from '@/lib/constants/z-index';
import { useToastStore } from '@/stores/toastStore';
import { useSnapshots, type Snapshot } from './useSnapshots';
import { triggerBlobDownload } from './shared/download';
import {
  formatScreenshotFileSize,
  formatScreenshotTime,
  isLightboxDismissKey,
  screenshotFileHost,
} from './shared/screenshot-utils';

interface SnapshotViewerProps {
  bookmarkId: string;
  bookmarkTitle: string;
  bookmarkUrl?: string;
  snapshotCount?: number; // 从书签数据中传入，避免额外请求
  /** chip：带文字的胶囊（卡片封面/标签行）；icon：与截图按钮同款的小图标 */
  variant?: 'chip' | 'icon';
  className?: string;
  iconClassName?: string;
}

function snapshotMeta(snapshot: Snapshot): string {
  return [
    snapshot.file_size > 0 ? formatScreenshotFileSize(snapshot.file_size) : '',
    formatScreenshotTime(snapshot.created_at),
  ].filter(Boolean).join(' · ');
}

export function SnapshotViewer({
  bookmarkId,
  bookmarkTitle,
  bookmarkUrl,
  snapshotCount = 0,
  variant = 'chip',
  className = '',
  iconClassName = 'w-4 h-4',
}: SnapshotViewerProps) {
  const { t } = useTranslation('bookmarks');
  const addToast = useToastStore((state) => state.addToast);
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const {
    snapshots,
    isLoading,
    deletingId,
    pendingDelete,
    showDeleteConfirm,
    loadSnapshots,
    handleRequestDelete,
    handleConfirmDelete,
    cancelDelete,
  } = useSnapshots(bookmarkId);

  // 默认展示最新版本；删除当前版本后自动落到剩下的最新一个
  const current = snapshots.find((s) => s.id === selectedId) ?? snapshots[0] ?? null;

  const handleOpen = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation(); // 防止触发卡片点击
    setSelectedId(null);
    setIsOpen(true);
    loadSnapshots();
  };

  // Esc 关闭 + 锁背景滚动；确认框打开时交给 ConfirmDialog 处理
  useEffect(() => {
    if (!isOpen) return;
    closeButtonRef.current?.focus({ preventScroll: true });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!showDeleteConfirm && isLightboxDismissKey(e.key)) setIsOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, showDeleteConfirm]);

  const handleDownload = async () => {
    if (!current) return;
    setIsDownloading(true);
    try {
      const response = await fetch(current.view_url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const host = bookmarkUrl ? screenshotFileHost(bookmarkUrl) : 'snapshot';
      triggerBlobDownload(await response.blob(), `${host}-snapshot-v${current.version}.html`);
      addToast('success', t('snapshot.downloadSuccess'));
    } catch (error) {
      console.error('Failed to download snapshot:', error);
      addToast('error', t('snapshot.downloadFailed'));
    } finally {
      setIsDownloading(false);
    }
  };

  // portal 里的事件仍会沿 React 树冒泡到触发它的卡片，这里统一截断
  const modalContent = isOpen ? createPortal(
    <div
      className="vibehub-modal-layer fixed inset-0 flex items-center justify-center p-2 sm:p-4 animate-fade-in"
      style={{ zIndex: Z_INDEX.SNAPSHOT_VIEWER }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="vibehub-modal-backdrop screenshot-lightbox-backdrop absolute inset-0 backdrop-blur-sm"
        onClick={() => setIsOpen(false)}
        aria-hidden="true"
      />

      {/* 弹窗容器 - 与网站截图灯箱保持一致 */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="vibehub-modal-panel relative card w-full max-w-5xl h-[92vh] flex flex-col min-h-0 overflow-hidden shadow-2xl animate-scale-in"
        style={{ backgroundColor: 'var(--card)', padding: 0 }}
      >
        <header
          className="flex items-start gap-3 p-4 sm:p-5 border-b flex-shrink-0"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex-1 min-w-0">
            <h2 id={titleId} className="text-base sm:text-lg font-bold text-foreground truncate" title={bookmarkTitle}>
              {bookmarkTitle}
            </h2>
            <p className="text-xs text-muted-foreground mt-1 truncate">
              {current
                ? [t('snapshot.version', { version: current.version }), snapshotMeta(current)].join(' · ')
                : t('snapshot.count', { count: isLoading ? snapshotCount : snapshots.length })}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={() => setIsOpen(false)}
            className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center text-foreground transition-colors flex-shrink-0"
            aria-label={t('snapshot.close')}
            title={t('snapshot.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {current && (
          <div
            className="flex flex-wrap items-center gap-2 px-4 sm:px-5 py-3 border-b flex-shrink-0"
            style={{ borderColor: 'var(--border)' }}
            role="toolbar"
            aria-label={t('snapshot.title')}
          >
            {snapshots.length > 1 && (
              <select
                value={current.id}
                onChange={(e) => setSelectedId(e.target.value)}
                className="input input-sm h-8 w-auto max-w-[14rem] text-sm"
                aria-label={t('snapshot.selectVersion')}
              >
                {snapshots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {t('snapshot.version', { version: s.version })} · {formatScreenshotTime(s.created_at)}
                  </option>
                ))}
              </select>
            )}

            <button type="button" onClick={handleDownload} disabled={isDownloading} className="btn btn-sm btn-outline">
              <Download className="w-4 h-4" />
              {t('snapshot.download')}
            </button>

            <a href={current.view_url} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-outline">
              <ExternalLink className="w-4 h-4" />
              {t('snapshot.openNewTab')}
            </a>

            {bookmarkUrl && (
              <a href={bookmarkUrl} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-outline">
                <Globe className="w-4 h-4" />
                {t('snapshot.openPage')}
              </a>
            )}

            <button
              type="button"
              onClick={(e) => handleRequestDelete(current.id, current.version, e)}
              disabled={deletingId === current.id}
              className="btn btn-sm btn-outline border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground ml-auto"
            >
              <Trash2 className="w-4 h-4" />
              {t('snapshot.delete')}
            </button>
          </div>
        )}

        <div className="flex-1 min-h-0 p-2 sm:p-4" style={{ backgroundColor: 'var(--muted)' }}>
          {isLoading ? (
            <div className="h-full flex flex-col items-center justify-center">
              <div className="animate-spin rounded-full h-10 w-10 border-4 border-primary/20 border-t-primary" />
              <p className="text-sm text-muted-foreground mt-4 font-medium">{t('snapshot.loading')}</p>
            </div>
          ) : !current ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground">
              <Camera className="w-14 h-14 mb-4 opacity-20" />
              <p className="text-base font-medium text-foreground mb-1">{t('snapshot.empty')}</p>
              <p className="text-xs">{t('snapshot.emptyHint')}</p>
            </div>
          ) : (
            // 快照响应自带 sandbox CSP，这里再加一层空 sandbox，禁止脚本、表单和弹窗
            <iframe
              key={current.id}
              src={current.view_url}
              title={t('snapshot.previewTitle', { version: current.version })}
              sandbox=""
              referrerPolicy="no-referrer"
              className="block w-full h-full rounded-lg shadow-lg bg-white"
              style={{ border: '1px solid var(--border)' }}
            />
          )}
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  const label = t('snapshot.viewCount', { count: snapshotCount });

  return (
    <>
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title={t('snapshot.deleteTitle')}
        message={pendingDelete ? t('snapshot.deleteMessage', { version: pendingDelete.version }) : t('snapshot.deleteConfirm')}
        type="warning"
        onConfirm={handleConfirmDelete}
        onCancel={cancelDelete}
      />

      {snapshotCount > 0 && (variant === 'icon' ? (
        <button
          type="button"
          onClick={handleOpen}
          onKeyDown={(e) => e.stopPropagation()}
          className={`bookmark-screenshot-button relative inline-flex items-center justify-center rounded-md transition-colors ${className}`}
          title={label}
          aria-label={label}
        >
          <Camera className={iconClassName} strokeWidth={2} />
          {snapshotCount > 1 && (
            <span className="bookmark-media-count absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full text-[9px] leading-[14px] font-semibold tabular-nums text-center">
              {snapshotCount}
            </span>
          )}
        </button>
      ) : (
        <button
          type="button"
          onClick={handleOpen}
          onKeyDown={(e) => e.stopPropagation()}
          className={`bookmark-media-chip inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium shadow-sm hover:scale-105 active:scale-95 transition-transform ${className}`}
          title={label}
          aria-label={label}
        >
          <Camera className="w-3 h-3" strokeWidth={2} />
          {t('snapshot.chip')}
          <span className="opacity-70 tabular-nums">{snapshotCount}</span>
        </button>
      ))}
      {modalContent}
    </>
  );
}
