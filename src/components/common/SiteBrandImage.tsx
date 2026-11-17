import { useEffect, useState, type ReactNode } from 'react'

interface SiteBrandImageProps {
  /** 站点 Logo / favicon 地址，可能为空或用户填写的外部 URL */
  src?: string | null
  alt: string
  /** 图片元素样式，尺寸由调用方决定 */
  className?: string
  /** 未设置或加载失败时渲染的回退内容 */
  fallback?: ReactNode
}

/**
 * 站点品牌图片。
 *
 * 图片只作为 <img> 资源展示，不解析任何 HTML；加载失败时回退到调用方给定的图标，
 * 地址变化后重置失败状态重新尝试加载，避免长期显示破图。
 */
export function SiteBrandImage({ src, alt, className, fallback = null }: SiteBrandImageProps) {
  const value = src?.trim() ?? ''
  const [failed, setFailed] = useState(false)

  // URL 改变后重新尝试加载
  useEffect(() => {
    setFailed(false)
  }, [value])

  if (!value || failed) return <>{fallback}</>

  return (
    <img
      src={value}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  )
}
