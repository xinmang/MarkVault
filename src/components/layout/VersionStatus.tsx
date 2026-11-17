import { useEffect, useState } from 'react'
import { ArrowUpCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PROJECT_REPOSITORY_URL } from '@/lib/constants/site'
import {
  compareVersions,
  fetchLatestVersion,
  isCacheFresh,
  readUpdateCache,
} from '@/lib/update-check'

/**
 * 页头 Logo 旁的版本状态：有新版本时显示更新图标，否则显示当前版本号。
 * 两种状态都链接到 GitHub 仓库，新标签页打开且不传递 opener。
 */
export function VersionStatus() {
  const { t } = useTranslation('common')
  const current = __APP_VERSION__
  const [latest, setLatest] = useState<string | null>(
    () => readUpdateCache()?.latestVersion ?? null
  )

  useEffect(() => {
    const controller = new AbortController()
    const check = () => {
      if (isCacheFresh(readUpdateCache())) return
      void fetchLatestVersion(controller.signal).then((version) => {
        if (version) setLatest(version)
      })
    }
    check()
    // 长时间挂着的标签页回到前台时再检查一次（受缓存间隔限制）
    const onVisible = () => {
      if (document.visibilityState === 'visible') check()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      controller.abort()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const hasUpdate = !!latest && compareVersions(latest, current) > 0
  const label = hasUpdate
    ? t('nav.updateAvailable', { current, latest })
    : t('nav.currentVersion', { version: current })

  return (
    <a
      href={PROJECT_REPOSITORY_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="version-status inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      data-has-update={hasUpdate ? 'true' : undefined}
      data-app-version={current}
      title={label}
      aria-label={label}
    >
      {hasUpdate ? (
        <>
          <ArrowUpCircle className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">{t('nav.update')}</span>
        </>
      ) : (
        <span>v{current}</span>
      )}
    </a>
  )
}
