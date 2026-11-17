import type { CSSProperties } from 'react'
import { useExperimentalFeatures } from '@/contexts/ExperimentalFeaturesContext'

interface BookmarkUrlTextProps {
  value: string
  className?: string
}

type PrivacyStyle = CSSProperties & {
  '--url-privacy-blur'?: string
  '--url-privacy-block-size'?: string
}

/**
 * 只改变网址文字的视觉呈现，不修改链接本身，确保开启隐私效果后仍能正常访问。
 */
export function BookmarkUrlText({ value, className = '' }: BookmarkUrlTextProps) {
  const { urlPrivacy } = useExperimentalFeatures()

  if (!urlPrivacy.enabled) {
    return <span className={className}>{value}</span>
  }

  const strength = Math.min(12, Math.max(1, urlPrivacy.strength))
  if (urlPrivacy.effect === 'mask') {
    const maskLength = Math.min(24, Math.max(10, Math.ceil(value.length / 3)))
    return (
      <span className={`url-privacy-mask ${className}`} aria-label="网址已隐藏">
        {'█'.repeat(maskLength)}
      </span>
    )
  }

  const style: PrivacyStyle = urlPrivacy.effect === 'blur'
    ? { '--url-privacy-blur': `${1 + strength * 0.55}px` }
    : { '--url-privacy-block-size': `${3 + strength}px` }

  return (
    <span
      className={`${urlPrivacy.effect === 'blur' ? 'url-privacy-blur' : 'url-privacy-mosaic'} ${className}`}
      style={style}
      aria-label="网址已隐藏"
    >
      {value}
    </span>
  )
}
