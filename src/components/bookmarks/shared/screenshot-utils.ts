/**
 * 网站截图（screenshot）相关的纯函数。
 *
 * 拆出来是为了让尺寸、文件名、剪贴板能力等逻辑可以被单元测试覆盖，
 * 组件里只保留 DOM 相关的副作用。
 */

import { format } from 'date-fns'
import type { BookmarkScreenshot } from '@/lib/types'

const FILE_SIZE_UNITS = ['B', 'KB', 'MB', 'GB'] as const

/** 文件大小，沿用快照列表的展示方式：保留一位小数 + 单位 */
export function formatScreenshotFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const unitIndex = Math.min(
    FILE_SIZE_UNITS.length - 1,
    Math.max(0, Math.floor(Math.log(bytes) / Math.log(1024)))
  )
  const value = bytes / 1024 ** unitIndex
  const unit = FILE_SIZE_UNITS[unitIndex] ?? 'B'
  return `${unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${unit}`
}

/** ISO 时间转成本地 “yyyy-MM-dd HH:mm”；无法解析时原样返回 */
export function formatScreenshotTime(value: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return format(date, 'yyyy-MM-dd HH:mm')
}

/** 头部元信息：宽×高 · 大小 · 时间 */
export function formatScreenshotMeta(
  screenshot: Pick<BookmarkScreenshot, 'width' | 'height' | 'file_size' | 'created_at'>
): string {
  const size = formatScreenshotFileSize(screenshot.file_size)
  const time = formatScreenshotTime(screenshot.created_at)
  const dimensions = `${screenshot.width}×${screenshot.height}`
  return [dimensions, size, time].filter(Boolean).join(' · ')
}

/** 下载文件名里的扩展名，跟随服务端给出的真实 MIME 类型 */
export function screenshotFileExtension(mimeType: string): string {
  const normalized = (mimeType || '').toLowerCase()
  if (normalized.includes('webp')) return 'webp'
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg'
  return 'png'
}

/** 从书签 URL 提取可用于文件名的域名 */
export function screenshotFileHost(bookmarkUrl: string): string {
  let host = ''
  try {
    host = new URL(bookmarkUrl).hostname
  } catch {
    host = bookmarkUrl
  }
  const cleaned = host
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  return cleaned.slice(0, 60) || 'bookmark'
}

function formatStamp(createdAt: string, fallback: Date): string {
  const date = new Date(createdAt)
  const safe = Number.isNaN(date.getTime()) ? fallback : date
  return format(safe, 'yyyyMMdd-HHmm')
}

/** markvault-<host>-<yyyyMMdd-HHmm>.<ext>，时间取截图的拍摄时间 */
export function screenshotFileName(
  bookmarkUrl: string,
  screenshot: Pick<BookmarkScreenshot, 'created_at' | 'mime_type'>,
  now: Date = new Date()
): string {
  const host = screenshotFileHost(bookmarkUrl)
  const stamp = formatStamp(screenshot.created_at, now)
  return `markvault-${host}-${stamp}.${screenshotFileExtension(screenshot.mime_type)}`
}

export interface ClipboardScope {
  ClipboardItem?: unknown
  clipboard?: { write?: unknown } | null
}

function defaultClipboardScope(): ClipboardScope | null {
  if (typeof navigator === 'undefined') return null
  return {
    ClipboardItem: typeof ClipboardItem === 'undefined' ? undefined : ClipboardItem,
    clipboard: navigator.clipboard ?? null,
  }
}

/**
 * 是否支持把图片写入剪贴板。
 * 通过 HTTP 自托管时浏览器通常不暴露 ClipboardItem，此时隐藏“复制图片”。
 */
export function supportsImageClipboard(
  scope: ClipboardScope | null = defaultClipboardScope()
): boolean {
  return (
    !!scope &&
    typeof scope.ClipboardItem === 'function' &&
    typeof scope.clipboard?.write === 'function'
  )
}

/** 剪贴板只接受 PNG，webp/jpeg 需要先经 canvas 转换 */
export function shouldConvertToPng(mimeType: string): boolean {
  return (mimeType || '').toLowerCase() !== 'image/png'
}

/** Esc 关闭弹窗 */
export function isLightboxDismissKey(key: string): boolean {
  return key === 'Escape'
}
