/**
 * 用字符拼出的边框图。
 * 生成一张 3×3 格的 SVG：四角、上下边、左右边各放一个字符，作为 border-image 的图源，
 * 浏览器把边上的那一格沿边平铺，就得到 +------+ 这样的字符边框。
 * 图片里的颜色无法跟随 CSS 变量，所以由脚本读取当前主题色后生成，写回 CSS 变量供样式引用。
 */

/** 一格字符的尺寸（像素），样式里的 border-image-slice 与 border-image-width 与之对应。 */
export const FRAME_CELL = { width: 7, height: 10 } as const

export interface FrameGlyphs {
  corner: string
  horizontal: string
  vertical: string
}

/** 普通边框：+--+ 与 | */
export const FRAME_PLAIN: FrameGlyphs = { corner: '+', horizontal: '-', vertical: '|' }
/** 强调边框（选中、当前项）：#==# 与 ‖ 的 ASCII 写法 */
export const FRAME_STRONG: FrameGlyphs = { corner: '#', horizontal: '=', vertical: '|' }

const FONT = "ui-monospace,'Cascadia Mono',Consolas,'SF Mono',Menlo,'Liberation Mono',monospace"

const escapeXml = (text: string) =>
  text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)

const dataUrl = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`

/** 边框图的 SVG 源码。color 需是 SVG 能识别的颜色写法（十六进制最稳妥）。 */
export function frameSvg(color: string, glyphs: FrameGlyphs = FRAME_PLAIN): string {
  const { width, height } = FRAME_CELL
  const cell = (col: number, row: number, glyph: string) =>
    `<text x="${col * width + width / 2}" y="${row * height + height - 2}">${escapeXml(glyph)}</text>`
  const cells = [
    cell(0, 0, glyphs.corner),
    cell(1, 0, glyphs.horizontal),
    cell(2, 0, glyphs.corner),
    cell(0, 1, glyphs.vertical),
    cell(2, 1, glyphs.vertical),
    cell(0, 2, glyphs.corner),
    cell(1, 2, glyphs.horizontal),
    cell(2, 2, glyphs.corner),
  ].join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width * 3}" height="${height * 3}">` +
    `<g fill="${escapeXml(color)}" font-family="${FONT}" font-size="11" font-weight="700" text-anchor="middle">${cells}</g></svg>`
  )
}

/** 可直接写进 CSS 变量的边框图。 */
export function frameImage(color: string, glyphs: FrameGlyphs = FRAME_PLAIN): string {
  return dataUrl(frameSvg(color, glyphs))
}

/** 遮罩层用的字符网点：一小块平铺图，交错放两个字符。 */
export function shadeImage(color: string, glyph = ':'): string {
  const text = escapeXml(glyph)
  return dataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="20">` +
      `<g fill="${escapeXml(color)}" font-family="${FONT}" font-size="11" text-anchor="middle">` +
      `<text x="4" y="8">${text}</text><text x="12" y="18">${text}</text></g></svg>`
  )
}

/** 样式里引用的变量名。 */
export const FRAME_VARIABLES = [
  '--ascii-frame',
  '--ascii-frame-accent',
  '--ascii-frame-strong',
  '--ascii-shade',
] as const

/** 由主题色得到各个变量的取值；line 为普通边框色，accent 为强调色，ink 为文字色。 */
export function frameVariables(colors: { line: string; accent: string; ink: string }) {
  return {
    '--ascii-frame': frameImage(colors.line),
    '--ascii-frame-accent': frameImage(colors.accent),
    '--ascii-frame-strong': frameImage(colors.accent, FRAME_STRONG),
    '--ascii-shade': shadeImage(colors.ink),
  } satisfies Record<(typeof FRAME_VARIABLES)[number], string>
}
