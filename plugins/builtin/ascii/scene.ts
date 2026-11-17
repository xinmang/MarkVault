/**
 * ASCII 画面的纯计算部分：亮度到字符的映射、海面场景、启动序列的时间线。
 * 不接触 DOM，画布渲染在 renderer.ts。
 */

/** 亮度从暗到亮对应的字符，第一个是空白。 */
export const LUMA_RAMP = [' ', '·', ':', '-', '=', '+', '↑', '#', '▪'] as const

/** 字符刚出现时闪烁的乱码。 */
export const GARBAGE_GLYPHS = '01{}[]<>/\\|#%&$@*+=-:;'

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/** 亮度（0–1）对应的字符。 */
export function glyphFor(luma: number): string {
  const index = Math.floor(clamp01(luma) * LUMA_RAMP.length)
  return LUMA_RAMP[Math.min(LUMA_RAMP.length - 1, index)]!
}

/** 由整数坐标得到 0–1 的伪随机数，同样的输入总是同样的结果。 */
export function hash(a: number, b: number, c = 0): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1274126177)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

export function garbageGlyph(col: number, row: number, tick: number): string {
  return GARBAGE_GLYPHS[Math.floor(hash(col, row, tick) * GARBAGE_GLYPHS.length)]!
}

/* ---------- 场景：云、地平线、海浪，左侧一棵树的剪影 ---------- */

export const HORIZON = 0.56
export type SceneZone = 'sky' | 'glow' | 'sea' | 'foam' | 'tree'
export interface SceneSample {
  luma: number
  zone: SceneZone
}

const smoothstep = (from: number, to: number, value: number) => {
  const t = clamp01((value - from) / (to - from))
  return t * t * (3 - 2 * t)
}

const TREE = { x: 0.13, canopyY: HORIZON - 0.2, radiusX: 0.075, radiusY: 0.125 }

function insideTree(x: number, y: number): boolean {
  if (Math.abs(x - TREE.x) < 0.009 && y > HORIZON - 0.14 && y < HORIZON + 0.025) return true
  // 树冠边缘加一点起伏，不是规整的椭圆
  const wobble = 1 + 0.12 * Math.sin(x * 90) * Math.cos(y * 70)
  const dx = (x - TREE.x) / (TREE.radiusX * wobble)
  const dy = (y - TREE.canopyY) / (TREE.radiusY * wobble)
  return dx * dx + dy * dy < 1
}

/**
 * 取场景在 (x, y) 处的亮度与区域。x、y 为 0–1 的画面坐标，time 为秒。
 * 天空有缓慢移动的云，靠近地平线发亮；海面的波纹越近越疏，右侧有一道涌起的大浪。
 */
export function sampleScene(x: number, y: number, time: number): SceneSample {
  if (insideTree(x, y)) return { luma: 0, zone: 'tree' }
  if (y < HORIZON) {
    const u = y / HORIZON
    const cloud =
      0.5 +
      0.5 *
        Math.sin(x * 7 + time * 0.05 + 2.2 * Math.sin(y * 9 - time * 0.03)) *
        Math.cos(y * 13 + x * 2.3)
    const glow = smoothstep(0.86, 1, u) * 0.34
    const luma = 0.1 + 0.14 * u + smoothstep(0.62, 0.95, cloud) * 0.55 * (1 - 0.5 * u) + glow
    return { luma: clamp01(luma), zone: u > 0.93 ? 'glow' : 'sky' }
  }
  const depth = (y - HORIZON) / (1 - HORIZON)
  const ripple = Math.sin(
    x * (46 - 30 * depth) +
      26 * Math.sqrt(depth) -
      time * 1.1 +
      1.7 * Math.sin(x * 5 + time * 0.25)
  )
  const swellX = 0.68 + 0.04 * Math.sin(time * 0.2)
  const swell = Math.exp(-((x - swellX) ** 2) / 0.03 - (depth - 0.34) ** 2 / 0.035)
  const luma = clamp01((0.14 + 0.5 * depth) * (0.35 + 0.65 * (0.5 + 0.5 * ripple)) + swell * 0.55)
  return { luma, zone: luma > 0.72 ? 'foam' : 'sea' }
}

/* ---------- 启动序列时间线（进度 0–1） ---------- */

/**
 * 各阶段在整段动画里的位置，比例取自 10 秒的参考分镜：
 * 0–1 秒打字，1–4.5 秒字符扩散，4.5–5 秒文字淡出，5–8.3 秒斜向扫描，之后画面完全揭开。
 */
export const BOOT_TIMELINE = {
  typeEnd: 0.1,
  spreadStart: 0.1,
  spreadEnd: 0.45,
  scanStart: 0.5,
  scanEnd: 0.83,
} as const

export type BootPhase = 'type' | 'spread' | 'hold' | 'scan' | 'done'

export function bootPhase(progress: number): BootPhase {
  if (progress < BOOT_TIMELINE.spreadStart) return 'type'
  if (progress < BOOT_TIMELINE.spreadEnd) return 'spread'
  if (progress < BOOT_TIMELINE.scanStart) return 'hold'
  if (progress < BOOT_TIMELINE.scanEnd) return 'scan'
  return 'done'
}

export const BOOT_LINES = ['> ASCII//MARKVAULT', '> LOAD SOURCE ... OK', '> LOCK SUBJECT_01'] as const

/** 打字阶段已经打出的字符数；三行连续计数。 */
export function typedCharacters(progress: number, total: number): number {
  return Math.floor(total * clamp01(progress / (BOOT_TIMELINE.typeEnd * 0.94)))
}

/** 启动文字的不透明度：扫描开始前淡出。 */
export function bootTextAlpha(progress: number): number {
  return 1 - smoothstep(BOOT_TIMELINE.spreadEnd, BOOT_TIMELINE.scanStart - 0.01, progress)
}

/** 乱码闪烁持续的进度长度。 */
export const GARBAGE_SPAN = 0.035

/** 离定位点 distance（0–1，1 为最远的角）的字符开始出现时的进度。 */
export function cellRevealAt(distance: number): number {
  const span = BOOT_TIMELINE.spreadEnd - BOOT_TIMELINE.spreadStart - GARBAGE_SPAN
  return BOOT_TIMELINE.spreadStart + clamp01(distance) * span * 0.94
}

export type CellStage = 'hidden' | 'garbage' | 'settled'

export function cellStage(progress: number, distance: number): CellStage {
  const start = cellRevealAt(distance)
  if (progress < start) return 'hidden'
  return progress < start + GARBAGE_SPAN ? 'garbage' : 'settled'
}

/** 扩散阶段的两次横向错位，各持续一小段。 */
export const GLITCH_WINDOWS: readonly (readonly [number, number])[] = [
  [0.24, 0.262],
  [0.37, 0.392],
]

export function glitchActive(progress: number): boolean {
  return GLITCH_WINDOWS.some(([from, to]) => progress >= from && progress < to)
}

/** 扫描带的宽度，以斜向坐标计。 */
export const SCAN_BAND = 0.13

/** 斜向坐标：左上角为 0，右下角为 1。 */
export function scanCoordinate(x: number, y: number): number {
  return (x + y) / 2
}

/** 扫描带前沿所在的斜向坐标；扫描结束时整条带子都已离开画面。 */
export function scanFront(progress: number): number {
  const t = clamp01(
    (progress - BOOT_TIMELINE.scanStart) / (BOOT_TIMELINE.scanEnd - BOOT_TIMELINE.scanStart)
  )
  return -0.02 + t * (1 + SCAN_BAND + 0.04)
}

export type ScanState = 'ascii' | 'edge' | 'band' | 'revealed'

/** 某一格相对扫描带的状态：尚未扫到、前沿的实心方块、带内、已经揭开。edge 为前沿的厚度。 */
export function scanState(coordinate: number, front: number, edge: number): ScanState {
  if (coordinate > front) return 'ascii'
  if (coordinate > front - edge) return 'edge'
  if (coordinate > front - SCAN_BAND) return 'band'
  return 'revealed'
}
