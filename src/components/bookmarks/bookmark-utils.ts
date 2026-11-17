import type { Bookmark } from '@/lib/types'

/**
 * 生成Google Favicon URL作为fallback
 */
export const getFaviconUrl = (url: string): string => {
  try {
    const urlObj = new URL(url)
    return `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=64`
  } catch {
    return ''
  }
}

/**
 * 检测 Google Favicon 是否为默认灰色地球图标
 * Google的默认图标通常是16x16或更小
 */
export const isGoogleDefaultIcon = (img: HTMLImageElement): boolean => {
  return img.naturalWidth <= 16 && img.naturalHeight <= 16
}

/** 书签是否有可查看的快照 */
export function hasBookmarkSnapshot(bookmark: Pick<Bookmark, 'has_snapshot' | 'snapshot_count'>): boolean {
  return !!bookmark.has_snapshot && (bookmark.snapshot_count ?? 0) > 0
}
