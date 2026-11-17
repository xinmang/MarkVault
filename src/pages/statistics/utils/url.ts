/** 仅 http(s) 链接才渲染为可点击的外链 */
export function isHttpUrl(url: string | null | undefined): url is string {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/** 提取主机名用于展示；非法 URL 直接返回原文（作为纯文本渲染） */
export function getHostname(url: string | null | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return url
  }
}

/**
 * 只允许作为图片源的安全来源：http(s)、data:image 以及同源的绝对路径。
 * 同源路径必须是单个 `/` 开头，避免 `//host`（协议相对）与 `javascript:` 等伪协议。
 */
export function isSafeImageSource(source: string | null | undefined): source is string {
  if (!source) return false
  const trimmed = source.trim()
  if (!trimmed) return false
  if (/^(https?:|data:image\/)/i.test(trimmed)) return true
  // 后端返回的本地 favicon 形如 /api/bookmark-images/images/abc?u=..&sig=..
  return trimmed.startsWith('/') && !trimmed.startsWith('//') && !trimmed.startsWith('/\\')
}
