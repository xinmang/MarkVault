import { useState, useCallback, memo, type SyntheticEvent } from 'react'
import { detectImageType, type ImageType } from '@/lib/image-utils'

interface AdaptiveImageProps {
  src: string
  alt: string
  className?: string
  onTypeDetected?: (type: ImageType) => void
  onError?: () => void
}

/**
 * 自适应图片组件
 * 根据图片比例自动判断类型并应用不同的样式
 */
export const AdaptiveImage = memo(function AdaptiveImage({ src, alt, className = '', onTypeDetected, onError }: AdaptiveImageProps) {
  // 状态按图片地址记录，地址变化后自然回到未加载状态
  const [loaded, setLoaded] = useState<{ src: string; type: ImageType } | null>(null)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const isLoaded = loaded?.src === src
  const imageType: ImageType = isLoaded ? loaded.type : 'unknown'

  // 直接用显示中的图片读取原始尺寸：读尺寸不需要跨域许可，
  // 也不会为了判断比例再以 CORS 模式重复下载一次（没有 CORS 头的站点会因此报错）
  const handleLoad = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = event.currentTarget
    const type = detectImageType(naturalWidth, naturalHeight)
    setLoaded({ src, type })
    onTypeDetected?.(type)
  }, [src, onTypeDetected])

  const handleError = useCallback(() => {
    setFailedSrc(src)
    onError?.()
  }, [src, onError])

  if (failedSrc === src) {
    return null
  }

  return (
    <img
      src={src}
      alt={alt}
      className={`${className} ${!isLoaded ? 'opacity-0' : 'opacity-100'} transition-opacity duration-200`}
      data-image-type={imageType}
      onLoad={handleLoad}
      onError={handleError}
    />
  )
})
