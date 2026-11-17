import type { OceanBackgroundMode } from '@/lib/ocean-background'
import { clamp } from './math'
import { AsciiRenderer } from './renderer'
import { World, type SharkSpec } from './world'
import { loadOceanState, saveOceanState } from './state'

const STEP = 1 / 60
const MAX_STEPS = 4
/** 背景层不需要满帧，30 帧足够流畅，也能把 CPU 占用压到一半。 */
const RENDER_INTERVAL = 1000 / 30
/** 点在这些元素上属于正常操作，不在背景里溅起水花。 */
const INTERACTIVE =
  'a, button, input, textarea, select, label, summary, [role="button"], [role="link"], .card'

const ROSTERS: Record<Exclude<OceanBackgroundMode, 'off'>, SharkSpec[]> = {
  sharks: [
    { kind: 'classic', size: 1 },
    { kind: 'hammerhead', size: 0.82 },
    { kind: 'mako', size: 0.74 },
  ],
  dolphins: [
    { kind: 'dolphin', size: 0.78 },
    { kind: 'dolphin', size: 0.7 },
    { kind: 'dolphin', size: 0.64 },
  ],
  mixed: [
    { kind: 'classic', size: 1 },
    { kind: 'dolphin', size: 0.72 },
    { kind: 'hammerhead', size: 0.8 },
    { kind: 'dolphin', size: 0.64 },
  ],
}

/** 手机屏幕只放前两条，避免大鱼挤满整屏。 */
export function oceanRoster(mode: OceanBackgroundMode, width: number): SharkSpec[] {
  if (mode === 'off') return []
  const roster = ROSTERS[mode]
  return width < 640 ? roster.slice(0, 2) : roster
}

/**
 * 把 ascii-sharks 的鱼群模拟接到整页背景上：固定步长模拟、最多 30 帧绘制，
 * 页面隐藏时停止循环；指针靠近时小鱼散开，点空白处溅起水花。
 */
export class AsciiOceanEngine {
  private world: World
  private renderer: AsciiRenderer
  private resizeObserver: ResizeObserver
  private frameId = 0
  private last = 0
  private lastRender = 0
  private acc = 0
  private disposed = false

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly mode: OceanBackgroundMode,
    private animated: boolean,
    dark: boolean
  ) {
    const bounds = canvas.getBoundingClientRect()
    // 整页背景上的小鱼比原项目少一些，避免和页面内容抢注意力。
    const fishCount = clamp(Math.round((bounds.width * bounds.height) / 6500), 40, 240)
    this.world = new World(oceanRoster(mode, bounds.width), fishCount)
    this.renderer = new AsciiRenderer(canvas, dark)
    this.renderer.setFontFamily('"Cascadia Code", Consolas, ui-monospace, Menlo, monospace')
    this.resizeObserver = new ResizeObserver(this.resize)
    // 关闭模式不绘制鱼群、背景光点，也不注册任何监听器或动画循环。
    if (mode === 'off') {
      this.disposed = true
      return
    }
    const snapshot = loadOceanState(mode)
    if (snapshot) this.world.restore(snapshot)
    this.resizeObserver.observe(canvas)
    document.addEventListener('visibilitychange', this.onVisibilityChange)
    window.addEventListener('pagehide', this.save)
    this.updatePointerListeners()
    this.resize()
    // 仅首次创建静态鱼群时预热；恢复、暂停和主题切换都保留原位置。
    if (!snapshot && !animated && this.world.width > 0) this.drawStill()
    this.schedule()
  }

  setOptions(animated: boolean, dark: boolean) {
    if (this.disposed) return
    this.renderer.setDark(dark)
    if (animated !== this.animated) {
      this.animated = animated
      this.acc = 0
      this.world.pointer.active = false
      this.updatePointerListeners()
      this.schedule()
    }
    this.renderer.render(this.world, 0)
  }

  private updatePointerListeners() {
    if (this.animated) {
      window.addEventListener('pointermove', this.onPointerMove, { passive: true })
      window.addEventListener('pointerdown', this.onPointerDown, { passive: true })
      window.addEventListener('blur', this.onPointerLeave)
      document.documentElement.addEventListener('pointerleave', this.onPointerLeave)
    } else {
      window.removeEventListener('pointermove', this.onPointerMove)
      window.removeEventListener('pointerdown', this.onPointerDown)
      window.removeEventListener('blur', this.onPointerLeave)
      document.documentElement.removeEventListener('pointerleave', this.onPointerLeave)
    }
  }

  destroy() {
    if (this.disposed) return
    this.save()
    this.disposed = true
    window.cancelAnimationFrame(this.frameId)
    this.resizeObserver.disconnect()
    document.removeEventListener('visibilitychange', this.onVisibilityChange)
    window.removeEventListener('pagehide', this.save)
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerdown', this.onPointerDown)
    window.removeEventListener('blur', this.onPointerLeave)
    document.documentElement.removeEventListener('pointerleave', this.onPointerLeave)
  }

  private resize = () => {
    if (this.disposed) return
    const bounds = this.canvas.getBoundingClientRect()
    if (bounds.width < 1 || bounds.height < 1) return
    this.renderer.resize(bounds.width, bounds.height, Math.min(window.devicePixelRatio || 1, 1.5))
    this.world.resize(
      bounds.width,
      bounds.height,
      this.renderer.cellWidth,
      this.renderer.cellHeight
    )
    // 挂载即绘制恢复的画面，不等待首个动画帧，避免切页时出现空白。
    this.renderer.render(this.world, 0)
  }

  private save = () => {
    if (!this.disposed && this.mode !== 'off') {
      saveOceanState(this.mode, this.world.snapshot())
    }
  }

  private onVisibilityChange = () => {
    if (document.hidden) {
      this.world.pointer.active = false
      this.save()
    }
    this.schedule()
  }

  private schedule = () => {
    window.cancelAnimationFrame(this.frameId)
    if (this.disposed || !this.animated || document.hidden) return
    this.last = 0
    this.frameId = window.requestAnimationFrame(this.frame)
  }

  private frame = (now: number) => {
    if (this.disposed || document.hidden) return
    if (!this.last) this.last = this.lastRender = now
    this.acc += Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    let steps = 0
    while (this.acc >= STEP && steps < MAX_STEPS) {
      this.world.step(STEP)
      this.acc -= STEP
      steps++
    }
    if (steps === MAX_STEPS) this.acc = 0
    if (now - this.lastRender >= RENDER_INTERVAL) {
      this.renderer.render(this.world, (now - this.lastRender) / 1000)
      this.lastRender = now
    }
    this.frameId = window.requestAnimationFrame(this.frame)
  }

  /** 静态画面：先让鱼群散开成自然的队形，再只画一帧。 */
  private drawStill() {
    if (this.world.time < 4) {
      for (let i = 0; i < 240; i++) this.world.step(STEP)
    }
    this.renderer.render(this.world, STEP)
  }

  private onPointerMove = (event: PointerEvent) => {
    const pointer = this.world.pointer
    pointer.x = event.clientX
    pointer.y = event.clientY
    pointer.active = event.pointerType !== 'touch'
  }

  private onPointerDown = (event: PointerEvent) => {
    if ((event.target as Element | null)?.closest?.(INTERACTIVE)) return
    this.world.splash(event.clientX, event.clientY)
  }

  private onPointerLeave = () => {
    this.world.pointer.active = false
  }
}
