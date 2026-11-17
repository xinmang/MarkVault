import { Chrome, Download, ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { CHROMIUM_BROWSERS, downloadExtension, EXTENSION_RELEASES_URL } from '@/lib/extension'

/** 插件详情和安装指南共用下载入口，安装包仍由扩展仓库独立发布。 */
export function BrowserExtensionDownload() {
  const { t } = useTranslation('info')
  return (
    <section
      className="extension-download-panel"
      aria-label={t('extension.download.title')}
      style={{
        padding: 24,
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        background: 'var(--card)',
        color: 'var(--foreground)',
      }}
    >
      <div className="flex items-center gap-4">
        <Chrome
          className="h-10 w-10 flex-none"
          style={{ color: 'var(--primary)' }}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <h2 className="font-bold">{t('extension.download.title')}</h2>
          <p className="mt-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>
            {CHROMIUM_BROWSERS.join(' · ')}
          </p>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="button" onClick={downloadExtension} className="btn btn-primary min-h-11">
          <Download size={16} />
          {t('extension.download.button')}
        </button>
        <a
          href={EXTENSION_RELEASES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-ghost min-h-11"
        >
          <ExternalLink size={16} />
          {t('extension.releaseInfo')}
        </a>
      </div>
    </section>
  )
}
