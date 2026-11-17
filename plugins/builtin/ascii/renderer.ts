/**
 * ASCII 主题的两块画布：常驻的字符背景，和进入页面时播放一次的启动序列。
 * 画面内容的计算都在 scene.ts，这里只负责网格、配色和绘制。
 */
import {
  BOOT_LINES,
  BOOT_TIMELINE,
  bootPhase,
  bootTextAlpha,
  cellStage,
  garbageGlyph,
  glitchActive,
  glyphFor,
  hash,
  sampleScene,
  scanCoordinate,
  scanFront,
  scanState,
  typedCharacters,
  type SceneZone,
} from './scene'

const FONT_FAMILY = 'ui-monospace, "Cascadia Mono", Consolas, "SF Mono", Menlo, monospace'
/** 高分屏也只按 1.5 倍绘制，字符背景不需要更高的清晰度。 */
const MAX_PIXEL_RATIO = 1.5

interface Grid {
  cols: number
  rows: number
  cellW: number
  cellH: number
  width: number
  height: number
}

/** 按视口和密度（百分比）划分字符网格并设置画布尺寸，返回可用的绘图上下文。 */
function layout(canvas: HTMLCanvasElement, density: number): { ctx: CanvasRenderingContext2D; grid: Grid } | null {
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const width = Math.max(1, window.innerWidth)
  const height = Math.max(1, window.innerHeight)
  const ratio = Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio || 1)
  const scale = 100 / Math.min(160, Math.max(40, density))
  const cellW = Math.max(7, Math.round(11 * scale))
  const cellH = Math.max(12, Math.round(20 * scale))
  canvas.width = Math.round(width * ratio)
  canvas.height = Math.round(height * ratio)
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.textBaseline = 'top'
  ctx.font = `${Math.round(cellH * 0.78)}px ${FONT_FAMILY}`
  return {
    ctx,
    grid: {
      cols: Math.ceil(width / cellW),
      rows: Math.ceil(height / cellH),
      cellW,
      cellH,
      width,
      height,
    },
  }
}

export type BackdropMode = 'field' | 'rain'

interface BackdropColors {
  ink: string
  accent: string
  dim: string
}

function readColors(): BackdropColors {
  const style = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  return {
    ink: read('--foreground', '#d5e2dc'),
    accent: read('--primary', '#35e6c3'),
    dim: read('--muted-foreground', '#7d8f87'),
  }
}

/**
 * 常驻字符背景。field 把海面场景画成字符并随指针起伏，rain 是自上而下的字符雨。
 * 低帧率绘制，页面隐藏时暂停；animated 为 false 时只画一帧静态画面。
 */
export class AsciiBackdrop {
  private ctx: CanvasRenderingContext2D | null = null
  private grid: Grid | null = null
  private colors: BackdropColors = { ink: '', accent: '', dim: '' }
  private frame = 0
  private lastDraw = 0
  private pointer: { x: number; y: number } | null = null
  private heads = new Float32Array(0)
  private speeds = new Float32Array(0)
  private destroyed = false

  constructor(
    private canvas: HTMLCanvasElement,
    private mode: BackdropMode,
    private density: number,
    private animated: boolean
  ) {
    window.addEventListener('resize', this.resize)
    document.addEventListener('visibilitychange', this.onVisibility)
    document.addEventListener('pointermove', this.onPointer, { passive: true })
    this.resize()
  }

  setOptions(mode: BackdropMode, density: number, animated: boolean) {
    const relayout = density !== this.density || mode !== this.mode
    this.mode = mode
    this.density = density
    this.animated = animated
    if (relayout) this.resize()
    else this.schedule()
  }

  /** 主题色变化后调用，重新读取颜色并重画。 */
  refresh() {
    this.colors = readColors()
    this.draw(performance.now())
    this.schedule()
  }

  destroy() {
    this.destroyed = true
    window.removeEventListener('resize', this.resize)
    document.removeEventListener('visibilitychange', this.onVisibility)
    document.removeEventListener('pointermove', this.onPointer)
    if (this.frame) cancelAnimationFrame(this.frame)
    this.frame = 0
  }

  private resize = () => {
    const result = layout(this.canvas, this.density)
    if (!result) return
    this.ctx = result.ctx
    this.grid = result.grid
    const { cols, rows } = result.grid
    this.heads = new Float32Array(cols)
    this.speeds = new Float32Array(cols)
    for (let col = 0; col < cols; col++) {
      this.heads[col] = hash(col, 1) * rows * 2 - rows
      this.speeds[col] = 0.35 + hash(col, 2) * 0.9
    }
    this.refresh()
  }

  private onVisibility = () => {
    if (!document.hidden) this.schedule()
  }

  private onPointer = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return
    this.pointer = { x: event.clientX, y: event.clientY }
  }

  private schedule() {
    if (this.destroyed || this.frame || !this.animated || document.hidden) return
    this.frame = requestAnimationFrame(this.tick)
  }

  private tick = (now: number) => {
    this.frame = 0
    // 字符画不需要高帧率：字符场每秒 10 帧，字符雨略快
    if (now - this.lastDraw >= (this.mode === 'rain' ? 70 : 100)) this.draw(now)
    this.schedule()
  }

  private draw(now: number) {
    const { ctx, grid } = this
    if (!ctx || !grid) return
    this.lastDraw = now
    ctx.clearRect(0, 0, grid.width, grid.height)
    if (this.mode === 'rain') this.drawRain(ctx, grid, now)
    else this.drawField(ctx, grid, now / 1000)
  }

  private drawField(ctx: CanvasRenderingContext2D, grid: Grid, time: number) {
    const { cols, rows, cellW, cellH } = grid
    const zoneColor: Record<SceneZone, string> = {
      sky: this.colors.dim,
      glow: this.colors.accent,
      sea: this.colors.accent,
      foam: this.colors.ink,
      tree: '',
    }
    const pointerCol = this.pointer ? this.pointer.x / cellW : -999
    const pointerRow = this.pointer ? this.pointer.y / cellH : -999
    let current = ''
    ctx.globalAlpha = 1
    for (let row = 0; row < rows; row++) {
      const y = (row + 0.5) / rows
      for (let col = 0; col < cols; col++) {
        const sample = sampleScene((col + 0.5) / cols, y, time)
        if (sample.zone === 'tree') continue
        // 指针附近的字符变亮，像在水面上按出一个鼓包（行高约为列宽的两倍）
        const dx = col - pointerCol
        const dy = (row - pointerRow) * 2
        const glyph = glyphFor(sample.luma + 0.4 * Math.exp(-(dx * dx + dy * dy) / 70))
        if (glyph === ' ') continue
        const color = zoneColor[sample.zone]
        if (color !== current) {
          ctx.fillStyle = color
          current = color
        }
        ctx.fillText(glyph, col * cellW, row * cellH)
      }
    }
  }

  private drawRain(ctx: CanvasRenderingContext2D, grid: Grid, now: number) {
    const { cols, rows, cellW, cellH } = grid
    const trail = 14
    const tick = Math.floor(now / 260)
    for (let col = 0; col < cols; col++) {
      if (this.animated) {
        this.heads[col]! += this.speeds[col]!
        if (this.heads[col]! - trail > rows) this.heads[col] = -hash(col, tick) * rows
      }
      const head = Math.floor(this.heads[col]!)
      for (let step = 0; step < trail; step++) {
        const row = head - step
        if (row < 0 || row >= rows) continue
        ctx.globalAlpha = 1 - step / trail
        ctx.fillStyle = step === 0 ? this.colors.ink : this.colors.accent
        ctx.fillText(garbageGlyph(col, row, tick), col * cellW, row * cellH)
      }
    }
    ctx.globalAlpha = 1
  }
}

/* ---------- 启动序列 ---------- */

/** 启动画面始终是黑底，配色固定：青绿色的乱码与定位标记，画面字符带场景本身的颜色。 */
const BOOT_COLORS = {
  background: '#000000',
  accent: '#3df2cf',
  block: '#d9fff6',
  zone: { sky: '#6fa8dc', glow: '#ffd58a', sea: '#2fb8a6', foam: '#eafff8', tree: '' } as Record<SceneZone, string>,
}
/** 定位标记所在位置：地平线上偏右的一点。 */
const SUBJECT = { x: 0.56, y: 0.6 }
const BOOT_FRAME_MS = 33
/** 扫描带里的流向箭头，朝右下方流动。 */
const FLOW_GLYPHS = ['>', '-', '\\', '>'] as const

export class AsciiBoot {
  private ctx: CanvasRenderingContext2D | null = null
  private grid: Grid | null = null
  private distance = new Float32Array(0)
  private frame = 0
  private started = 0
  private lastDraw = 0
  private finished = false

  constructor(
    private canvas: HTMLCanvasElement,
    private duration: number,
    private onDone: () => void
  ) {
    window.addEventListener('resize', this.resize)
    window.addEventListener('keydown', this.skip)
    canvas.addEventListener('pointerdown', this.skip)
    this.resize()
    this.frame = requestAnimationFrame(this.tick)
  }

  destroy() {
    window.removeEventListener('resize', this.resize)
    window.removeEventListener('keydown', this.skip)
    this.canvas.removeEventListener('pointerdown', this.skip)
    if (this.frame) cancelAnimationFrame(this.frame)
    this.frame = 0
  }

  /** 点击或按键直接结束，不让动画挡住操作。 */
  private skip = () => this.finish()

  private finish() {
    if (this.finished) return
    this.finished = true
    this.destroy()
    this.onDone()
  }

  private resize = () => {
    const result = layout(this.canvas, 92)
    if (!result) return
    this.ctx = result.ctx
    this.grid = result.grid
    const { cols, rows, width, height } = result.grid
    // 每格到定位点的距离，按最远的角归一化；横向按画面比例折算，扩散才是圆形
    const aspect = width / height
    const far = Math.max(
      ...[0, 1].flatMap((x) => [0, 1].map((y) => Math.hypot((x - SUBJECT.x) * aspect, y - SUBJECT.y)))
    )
    this.distance = new Float32Array(cols * rows)
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < cols; col++)
        this.distance[row * cols + col] =
          Math.hypot(((col + 0.5) / cols - SUBJECT.x) * aspect, (row + 0.5) / rows - SUBJECT.y) / far
  }

  private tick = (now: number) => {
    this.frame = 0
    if (!this.started) this.started = now
    const progress = (now - this.started) / this.duration
    // 扫描带离开画面后界面已完全露出，不必等到时间线末尾
    if (progress >= BOOT_TIMELINE.scanEnd + 0.01) return this.finish()
    if (now - this.lastDraw >= BOOT_FRAME_MS) {
      this.lastDraw = now
      this.draw(progress, now)
    }
    this.frame = requestAnimationFrame(this.tick)
  }

  private draw(progress: number, now: number) {
    const { ctx, grid } = this
    if (!ctx || !grid) return
    const { cols, rows, cellW, cellH, width, height } = grid
    const phase = bootPhase(progress)
    const scanning = phase === 'scan' || phase === 'done'
    const front = scanning ? scanFront(progress) : -1
    const edge = 1.6 / cols
    const tick = Math.floor(now / 70)
    const glitch = glitchActive(progress)
    const time = now / 1000

    ctx.globalAlpha = 1
    ctx.fillStyle = BOOT_COLORS.background
    ctx.fillRect(0, 0, width, height)

    for (let row = 0; row < rows; row++) {
      const y = (row + 0.5) / rows
      const top = row * cellH
      // 故障闪烁：每隔几行整体横移几格
      const shift =
        glitch && hash(Math.floor(row / 3), tick, 5) < 0.3
          ? Math.round((hash(Math.floor(row / 3), tick, 9) - 0.5) * 10)
          : 0
      for (let col = 0; col < cols; col++) {
        const x = (col + 0.5) / cols
        const left = col * cellW
        if (scanning) {
          const state = scanState(scanCoordinate(x, y), front, edge)
          if (state === 'revealed') {
            ctx.clearRect(left, top, cellW, cellH)
            continue
          }
          if (state === 'edge') {
            ctx.globalAlpha = 1
            ctx.fillStyle = BOOT_COLORS.block
            ctx.fillRect(left, top, cellW - 1, cellH - 1)
            continue
          }
          if (state === 'band') {
            // 带内已经能透出界面，上面流过箭头，零星亮着追踪节点
            ctx.clearRect(left, top, cellW, cellH)
            ctx.globalAlpha = 0.55
            ctx.fillStyle = BOOT_COLORS.background
            ctx.fillRect(left, top, cellW, cellH)
            const node = hash(col, row, 3) < 0.012
            if (node || (col + row * 2 - tick) % 4 === 0) {
              ctx.globalAlpha = node ? 1 : 0.85
              ctx.fillStyle = node ? BOOT_COLORS.block : BOOT_COLORS.accent
              ctx.fillText(node ? '+' : FLOW_GLYPHS[(col + tick) & 3]!, left, top)
            }
            continue
          }
        }
        const stage = cellStage(progress, this.distance[row * cols + col]!)
        if (stage === 'hidden') continue
        if (stage === 'garbage') {
          ctx.globalAlpha = 0.9
          ctx.fillStyle = BOOT_COLORS.accent
          ctx.fillText(garbageGlyph(col, row, tick), left + shift * cellW, top)
          continue
        }
        const sample = sampleScene(x, y, time)
        const glyph = glyphFor(sample.luma)
        if (glyph === ' ' || sample.zone === 'tree') continue
        ctx.globalAlpha = 0.4 + 0.6 * sample.luma
        ctx.fillStyle = BOOT_COLORS.zone[sample.zone]
        ctx.fillText(glyph, left + shift * cellW, top)
      }
    }

    this.drawMarker(ctx, grid, progress)
    this.drawLog(ctx, grid, progress, now)
  }

  /** 青色十字定位标记，画面铺满后淡出。 */
  private drawMarker(ctx: CanvasRenderingContext2D, grid: Grid, progress: number) {
    const alpha = bootTextAlpha(progress)
    if (alpha <= 0) return
    const { cols, rows, cellW, cellH } = grid
    const col = Math.floor(SUBJECT.x * cols)
    const row = Math.floor(SUBJECT.y * rows)
    const put = (dc: number, dr: number, glyph: string) => {
      // 标记只在扫描开始前出现，此时画布仍是不透明的黑底。
      // 用底色盖住这一格里已有的字符；若改用 clearRect 会把画布挖透，露出底下的界面。
      ctx.globalAlpha = 1
      ctx.fillStyle = BOOT_COLORS.background
      ctx.fillRect((col + dc) * cellW, (row + dr) * cellH, cellW, cellH)
      ctx.globalAlpha = alpha
      ctx.fillStyle = BOOT_COLORS.accent
      ctx.fillText(glyph, (col + dc) * cellW, (row + dr) * cellH)
    }
    put(0, 0, '+')
    for (const offset of [1, 2, 3]) {
      put(offset, 0, '-')
      put(-offset, 0, '-')
    }
    for (const offset of [1, 2]) {
      put(0, offset, '|')
      put(0, -offset, '|')
    }
    put(-5, -3, '[')
    put(5, -3, ']')
    put(-5, 3, '[')
    put(5, 3, ']')
  }

  /** 左上角逐字打出的启动信息，末尾是闪烁的光标。 */
  private drawLog(ctx: CanvasRenderingContext2D, grid: Grid, progress: number, now: number) {
    const alpha = bootTextAlpha(progress)
    if (alpha <= 0) return
    const { cellW, cellH } = grid
    const total = BOOT_LINES.reduce((sum, line) => sum + line.length, 0)
    let remaining = typedCharacters(progress, total)
    const cursor = Math.floor(now / 320) % 2 === 0
    BOOT_LINES.forEach((line, index) => {
      if (remaining <= 0 && index > 0) return
      const typed = line.slice(0, Math.max(0, remaining))
      const last = remaining <= line.length
      remaining -= line.length
      const text = typed + (last && cursor ? '_' : '')
      const left = cellW * 2
      const top = cellH * (1 + index * 1.3)
      // 先铺一块黑底，文字不与扩散出来的字符叠在一起
      ctx.globalAlpha = alpha
      ctx.fillStyle = BOOT_COLORS.background
      ctx.fillRect(left - cellW, top - 2, (line.length + 3) * cellW, cellH * 1.3)
      ctx.fillStyle = BOOT_COLORS.accent
      ctx.fillText(text, left, top)
    })
  }
}
