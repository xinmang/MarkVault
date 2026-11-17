import { useState } from 'react'
import { Tag as TagGlyph } from 'lucide-react'
import { resolveTagIcon } from '@/lib/tag-icons'

interface TagIconProps {
  name: string
  icon?: string | null
  className?: string
}

export function TagIcon({ name, icon, className = 'h-4 w-4' }: TagIconProps) {
  const resolved = resolveTagIcon(name, icon)
  const [failedSource, setFailedSource] = useState<string | null>(null)
  if (resolved?.kind === 'brand') {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
        <path d={resolved.path} />
      </svg>
    )
  }
  if (resolved?.kind === 'icon') {
    const Icon = resolved.component
    return <Icon className={className} aria-hidden="true" />
  }
  if (resolved?.kind === 'image' && failedSource !== resolved.src) {
    return (
      <img
        src={resolved.src}
        alt=""
        className={className + ' object-contain'}
        referrerPolicy="no-referrer"
        onError={() => setFailedSource(resolved.src)}
      />
    )
  }
  return <TagGlyph className={className} aria-hidden="true" />
}
