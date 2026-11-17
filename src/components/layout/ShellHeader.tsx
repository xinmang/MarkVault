import type React from 'react'
import { BookOpen } from 'lucide-react'
import { VersionStatus } from '@/components/layout/VersionStatus'
import { SiteBrandImage } from '@/components/common/SiteBrandImage'
import { useSiteBranding } from '@/contexts/SiteBrandingContext'
import { PageSpeedBadge } from '../../../plugins/builtin/page-speed/PageSpeedBadge'

export function ShellHeader({
  title,
  subtitle,
  onHome,
  onLogoClick,
  logoIcon,
  logoTitle,
  right,
  trailing,
}: {
  /** 留空时使用站点品牌名称，保证全站名称统一 */
  title?: string
  subtitle?: React.ReactNode
  onHome: () => void
  onLogoClick?: () => void
  logoIcon?: React.ReactNode
  logoTitle?: string
  right?: React.ReactNode
  /** 渲染在页头最外端的内容（例如设置入口） */
  trailing?: React.ReactNode
}) {
  const { siteName, siteDescription, siteLogo } = useSiteBranding()
  const displayTitle = title?.trim() || siteName
  // 站点描述优先：用户配置了网站描述时全站页头统一展示它
  const displaySubtitle = siteDescription.trim() || subtitle

  return (
    <header className="shell-header h-16 sm:h-20 sticky top-0 z-50 backdrop-filter backdrop-blur-xl bg-card/80 border-b border-border/50 shadow-float flex items-center">
      <div className="mx-auto flex w-full min-w-0 max-w-full items-center justify-between gap-2 px-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={onLogoClick ?? onHome}
            className="shell-header-logo-button inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg transition-all duration-200 hover:opacity-80 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 sm:rounded-xl"
            title={logoTitle}
            aria-label={logoTitle ?? displayTitle}
          >
            {siteLogo ? (
              // 站点的自定义 Logo：仅作为图片资源展示，不解析任何 HTML
              <div className="shell-header-logo flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-card shadow-float sm:h-11 sm:w-11 sm:rounded-xl">
                <SiteBrandImage
                  src={siteLogo}
                  alt={displayTitle}
                  className="h-full w-full object-contain"
                  fallback={<BookOpen className="w-5 h-5 sm:w-7 sm:h-7 text-primary" />}
                />
              </div>
            ) : (
              <div className="shell-header-logo w-9 h-9 sm:w-11 sm:h-11 rounded-lg sm:rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-float">
                {logoIcon ?? (
                  <BookOpen
                    className="w-5 h-5 sm:w-7 sm:h-7"
                    style={{ color: 'var(--foreground)' }}
                  />
                )}
              </div>
            )}
          </button>

          <button
            type="button"
            onClick={onHome}
            className="shell-header-title flex min-w-0 flex-col justify-center rounded-md text-left transition-opacity duration-200 hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            title={displayTitle}
          >
            {/* 长站点名称在手机宽度下截断，避免挤压右侧操作区 */}
            <h1
              className="max-w-[45vw] truncate text-lg font-bold sm:max-w-[18rem] sm:text-2xl lg:max-w-[24rem]"
              style={{ color: 'var(--primary)' }}
            >
              {displayTitle}
            </h1>
            {displaySubtitle && (
              <p
                className="hidden max-w-[45vw] truncate text-xs font-medium sm:block sm:max-w-[18rem] lg:max-w-[24rem]"
                style={{ color: 'var(--muted-foreground)' }}
              >
                {displaySubtitle}
              </p>
            )}
          </button>
          <VersionStatus />
        </div>

        <div className="flex flex-shrink-0 items-center gap-1 sm:gap-2 md:gap-3">
          {right}
          {trailing}
        </div>
      </div>
      <PageSpeedBadge />
    </header>
  )
}
