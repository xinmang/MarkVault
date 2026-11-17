/**
 * 站点品牌信息的常量与校验规则。
 *
 * 与后端 internal/server/site.go 的限额保持一致：
 * - 名称 1–80 字符（按 Unicode 码点计算，与 Go 的 RuneCount 对齐）
 * - 描述最多 300 字符
 * - Logo / favicon 支持 HTTP(S) 图片地址或不超过 256 KiB 的位图 data URI
 */

export const DEFAULT_SITE_NAME = 'MarkVault'

export const MAX_SITE_NAME_LENGTH = 80
export const MAX_SITE_DESCRIPTION_LENGTH = 300
export const MAX_SITE_IMAGE_BYTES = 256 * 1024
export const MAX_SITE_IMAGE_URL_LENGTH = 2048

/** 上传控件允许选择的位图类型，SVG 与 HTML 一律不接受 */
export const SITE_IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp'
export const SITE_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

const imageDataPattern = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/

/** 默认 favicon：静态常量，不来自用户输入，保证未设置时浏览器标签也有图标 */
export const DEFAULT_SITE_FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%233b82f6'/%3E%3Cpath d='M9 8h14v17l-7-4.5-7 4.5z' fill='%23ffffff'/%3E%3C/svg%3E"

/** 按码点计算长度，避免中文等多字节字符被误判为超长 */
export function countCharacters(value: string): number {
  return Array.from(value).length
}

export function isValidSiteName(value: string): boolean {
  const length = countCharacters(value.trim())
  return length >= 1 && length <= MAX_SITE_NAME_LENGTH
}

export function isValidSiteDescription(value: string): boolean {
  return countCharacters(value.trim()) <= MAX_SITE_DESCRIPTION_LENGTH
}

/**
 * 校验站点图片字段：空值表示使用默认外观。
 * 只接受 HTTP(S) 图片地址或体积受限的位图 data URI，拒绝 javascript:、file:、
 * 带用户凭据的 URL 以及 SVG/HTML 内容。
 */
export function isValidSiteImage(value: string): boolean {
  const text = value.trim()
  if (!text) return true

  if (text.startsWith('data:')) {
    if (!imageDataPattern.test(text)) return false
    const base64 = text.slice(text.indexOf(',') + 1)
    if (base64.length % 4 !== 0) return false
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
    return (base64.length / 4) * 3 - padding <= MAX_SITE_IMAGE_BYTES
  }

  if (text.length > MAX_SITE_IMAGE_URL_LENGTH) return false
  try {
    const url = new URL(text)
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    )
  } catch {
    return false
  }
}

/**
 * 读取用户选择的图片文件并生成 data URI。
 * 只做前端预校验，最终仍由服务端校验 MIME 与体积。
 * 任何无效结果都 reject，不能被当作“清空图片”写回表单。
 */
export function readSiteImageFile(file: File): Promise<string> {
  if (file.size > MAX_SITE_IMAGE_BYTES) {
    return Promise.reject(new Error('FILE_TOO_LARGE'))
  }
  if (!SITE_IMAGE_MIME_TYPES.includes(file.type)) {
    return Promise.reject(new Error('UNSUPPORTED_TYPE'))
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      if (!isValidSiteImage(result) || !result.startsWith('data:image/')) {
        reject(new Error('INVALID_IMAGE'))
        return
      }
      resolve(result)
    }
    reader.onerror = () => reject(new Error('READ_FAILED'))
    reader.readAsDataURL(file)
  })
}
