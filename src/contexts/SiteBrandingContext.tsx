import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { usePublicSiteBranding } from '@/hooks/useSiteBranding'
import { DEFAULT_SITE_FAVICON, DEFAULT_SITE_NAME } from '@/lib/site-branding'

interface SiteBrandingContextValue {
  siteName: string
  siteDescription: string
  siteLogo: string
  siteFavicon: string
  /** 页面可覆盖浏览器标题前缀，例如分享页使用自己的内容标题 */
  setPageTitle: (title: string | null) => void
}

const SiteBrandingContext = createContext<SiteBrandingContextValue | null>(null)

const DESCRIPTION_META_SELECTOR = 'meta[name="description"]'
const FAVICON_ATTR = 'data-site-favicon'

/** 确保 description meta 与 favicon link 存在，缺失时补齐，便于托管在不同 index.html 上 */
function ensureDescriptionMeta(): HTMLMetaElement {
  const existing = document.head.querySelector<HTMLMetaElement>(DESCRIPTION_META_SELECTOR)
  if (existing) return existing
  const meta = document.createElement('meta')
  meta.setAttribute('name', 'description')
  document.head.appendChild(meta)
  return meta
}

function ensureFaviconLink(): HTMLLinkElement {
  const existing = document.head.querySelector<HTMLLinkElement>(`link[${FAVICON_ATTR}]`)
  if (existing) return existing
  const link = document.createElement('link')
  link.rel = 'icon'
  link.setAttribute(FAVICON_ATTR, 'true')
  document.head.appendChild(link)
  return link
}

/**
 * 站点品牌上下文。
 *
 * 必须放在 QueryClientProvider 内部（App 根组件本身在 Provider 之外），
 * 由它统一把品牌写入页头、浏览器标题、favicon 与 description meta。
 */
export function SiteBrandingProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const { data } = usePublicSiteBranding()
  const [pageTitle, setPageTitleState] = useState<string | null>(null)

  const siteName = data?.site_name?.trim() || DEFAULT_SITE_NAME
  const siteDescription = data?.site_description?.trim() ?? ''
  const siteLogo = data?.site_logo?.trim() ?? ''
  const siteFavicon = data?.site_favicon?.trim() ?? ''
  const defaultDescription = t('brand.defaultDescription')

  const setPageTitle = useCallback((title: string | null) => {
    const next = title?.trim() || null
    setPageTitleState((current) => (current === next ? current : next))
  }, [])

  // 浏览器标题：分享页等内容页可覆盖前缀，其余页面使用站点名称与描述
  useEffect(() => {
    const description = siteDescription || defaultDescription
    document.title = pageTitle
      ? `${pageTitle} - ${siteName}`
      : description
        ? `${siteName} - ${description}`
        : siteName
  }, [pageTitle, siteName, siteDescription, defaultDescription])

  // description meta 只暴露站点描述，不泄漏站内实现细节
  useEffect(() => {
    ensureDescriptionMeta().setAttribute('content', siteDescription || defaultDescription)
  }, [siteDescription, defaultDescription])

  useEffect(() => {
    ensureFaviconLink().href = siteFavicon || siteLogo || DEFAULT_SITE_FAVICON
  }, [siteFavicon, siteLogo])

  const value = useMemo<SiteBrandingContextValue>(
    () => ({ siteName, siteDescription, siteLogo, siteFavicon, setPageTitle }),
    [siteName, siteDescription, siteLogo, siteFavicon, setPageTitle]
  )

  return <SiteBrandingContext.Provider value={value}>{children}</SiteBrandingContext.Provider>
}

const fallbackValue: SiteBrandingContextValue = {
  siteName: DEFAULT_SITE_NAME,
  siteDescription: '',
  siteLogo: '',
  siteFavicon: '',
  setPageTitle: () => {},
}

/** 读取站点品牌信息；未包裹 Provider 时回退到默认品牌，避免组件崩溃 */
// eslint-disable-next-line react-refresh/only-export-components
export function useSiteBranding(): SiteBrandingContextValue {
  return useContext(SiteBrandingContext) ?? fallbackValue
}
