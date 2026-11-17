/**
 * 图片工具模块
 * 用于检测图片比例、类型判断和自适应处理
 */

export type ImageType = 'favicon' | 'cover' | 'unknown'

/**
 * 判断图片类型
 * - favicon: 正方形或接近正方形的图标 (宽高比在 0.8-1.25 之间)
 * - cover: 横向长方形封面图 (宽度明显大于高度)
 * - unknown: 其他类型
 */
export function detectImageType(width: number, height: number): ImageType {
  if (width === 0 || height === 0) {
    return 'unknown'
  }

  const aspectRatio = width / height

  // 正方形或接近正方形 (0.8 - 1.25)
  if (aspectRatio >= 0.8 && aspectRatio <= 1.25) {
    return 'favicon'
  }

  // 横向长方形 (宽度大于高度)
  if (aspectRatio > 1.25) {
    return 'cover'
  }

  // 纵向或其他
  return 'unknown'
}

/**
 * 获取图片的 CSS 类名，用于不同类型的样式
 */
export function getImageClassName(type: ImageType): string {
  switch (type) {
    case 'favicon':
      return 'image-favicon'
    case 'cover':
      return 'image-cover'
    default:
      return 'image-unknown'
  }
}
