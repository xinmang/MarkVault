import {
  attractPoint,
  circle,
  fusedPath,
  pullStrength,
  roundRect,
  shapeDistance,
  springSettled,
  stepSpring,
  type GlassShape,
  type Point,
  type Spring,
} from './metaball'
import { GLASS_TARGETS, fusionRadius, fusionReach } from './settings'

export interface FusionOptions {
  droplet: boolean
  highlight: boolean
  fusion: number
}

const TEXT_TARGETS =
  'textarea, select, [contenteditable="true"], input:not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="submit"]):not([type="reset"]):not([type="color"]):not([type="file"])'

/** 水滴的静止半径；按下时收紧，进入按钮后略小，让按钮本身成为主体。 */
const DROP_RADIUS = 15
/** 同时参与融合的形状上限：指针附近最近的几个。 */
const MAX_ENGAGED = 6
/** 过大的元素不是按钮（例如整行的卡片），不参与融合。 */
const MAX_TARGET_WIDTH = 440
const MAX_TARGET_HEIGHT = 96
/** 候选元素的位置缓存多久重新读取一次。 */
const CANDIDATE_TTL = 240
/** 指针停下多久后暂停逐帧计算。 */
const IDLE_AFTER = 500
/** 暂停期间隔多久核对一次：指针没动但页面内容变了（切页、按钮消失）时轮廓也要跟上。 */
const HEARTBEAT = 400
const FUSED_ATTRIBUTE = 'data-lg-fused'
const HIGHLIGHT_VARIABLES = ['--lg-px', '--lg-py', '--lg-glow']

interface Candidate {
  element: HTMLElement
  shape: GlassShape
  left: number
  top: number
  width: number
  height: number
}

/** precise 为 false 时不读取圆角，只用于按距离粗筛，省去一次样式计算。 */
function readCandidate(element: HTMLElement, precise: boolean): Candidate | null {
  const box = element.getBoundingClientRect()
  if (box.width < 12 || box.height < 12) return null
  if (box.width > MAX_TARGET_WIDTH || box.height > MAX_TARGET_HEIGHT) return null
  if (box.bottom < 0 || box.right < 0 || box.top > innerHeight || box.left > innerWidth)
    return null
  const radius = precise
    ? Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0
    : 0
  return {
    element,
    shape: roundRect(box.left, box.top, box.width, box.height, radius),
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
  }
}

/** 元素中心被别的内容盖住（滚到页头下面、被弹窗遮住）时不参与融合。 */
function isOnTop(candidate: Candidate): boolean {
  const hit = document.elementFromPoint(candidate.shape.cx, candidate.shape.cy)
  return !!hit && (hit === candidate.element || candidate.element.contains(hit))
}

/**
 * 液态玻璃的融合图层：指针带着一颗玻璃水滴，靠近按钮时被吸过去，
 * 水滴、按钮以及相邻的按钮融合成一个形状，轮廓每帧重新计算。
 *
 * lens 是一块铺满视口的玻璃，用 clip-path 裁成融合后的形状；rim 沿同一条轮廓描出高光边。
 * 两者都不接收指针事件，按钮本身照常响应点击。指针停下、弹簧都静止后暂停计算。
 */
export class GlassFusion {
  private options: FusionOptions
  private pointer: Point = { x: 0, y: 0 }
  private present = false
  private pressed = false
  private overText = false
  private movedAt = 0
  private dropX: Spring = { value: 0, velocity: 0 }
  private dropY: Spring = { value: 0, velocity: 0 }
  private tailX: Spring = { value: 0, velocity: 0 }
  private tailY: Spring = { value: 0, velocity: 0 }
  private radius: Spring = { value: 0, velocity: 0 }
  private placed = false
  private candidates: Candidate[] = []
  private candidatesAt = -Infinity
  private stale = true
  private engaged = new Map<HTMLElement, number>()
  private frame = 0
  private heartbeat = 0
  private last = 0
  private path = ''

  constructor(
    private lens: HTMLElement,
    private rim: SVGPathElement,
    options: FusionOptions
  ) {
    this.options = options
    addEventListener('pointermove', this.onMove, { passive: true })
    addEventListener('pointerdown', this.onDown, { passive: true })
    addEventListener('pointerup', this.onUp, { passive: true })
    addEventListener('pointercancel', this.onUp, { passive: true })
    addEventListener('blur', this.onLeave)
    addEventListener('resize', this.onLayout, { passive: true })
    // 捕获阶段监听，页面里任何滚动容器滚动都会让按钮的位置失效
    addEventListener('scroll', this.onLayout, { passive: true, capture: true })
    document.documentElement.addEventListener('pointerleave', this.onLeave)
  }

  setOptions(options: FusionOptions) {
    this.options = options
    this.wake()
  }

  destroy() {
    removeEventListener('pointermove', this.onMove)
    removeEventListener('pointerdown', this.onDown)
    removeEventListener('pointerup', this.onUp)
    removeEventListener('pointercancel', this.onUp)
    removeEventListener('blur', this.onLeave)
    removeEventListener('resize', this.onLayout)
    removeEventListener('scroll', this.onLayout, { capture: true })
    document.documentElement.removeEventListener('pointerleave', this.onLeave)
    if (this.frame) cancelAnimationFrame(this.frame)
    this.frame = 0
    clearTimeout(this.heartbeat)
    for (const element of this.engaged.keys()) this.release(element)
    this.engaged.clear()
    this.draw('')
  }

  private onMove = (event: PointerEvent) => {
    // 触摸没有悬停，水滴只跟随鼠标和手写笔
    if (event.pointerType === 'touch') return
    this.pointer = { x: event.clientX, y: event.clientY }
    this.present = true
    this.movedAt = performance.now()
    this.overText = event.target instanceof Element && event.target.closest(TEXT_TARGETS) !== null
    this.wake()
  }

  private onDown = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return
    this.pressed = true
    this.wake()
  }

  private onUp = () => {
    this.pressed = false
    this.wake()
  }

  private onLeave = () => {
    this.present = false
    this.pressed = false
    this.wake()
  }

  private onLayout = () => {
    this.stale = true
    if (this.present) this.wake()
  }

  private wake = () => {
    clearTimeout(this.heartbeat)
    if (this.frame) return
    this.last = performance.now()
    this.frame = requestAnimationFrame(this.tick)
  }

  private refreshCandidates(now: number) {
    if (!this.stale && now - this.candidatesAt < CANDIDATE_TTL) return
    this.stale = false
    this.candidatesAt = now
    this.candidates = []
    for (const element of document.querySelectorAll<HTMLElement>(GLASS_TARGETS)) {
      if (element.matches(':disabled, [aria-disabled="true"]')) continue
      const candidate = readCandidate(element, false)
      if (candidate) this.candidates.push(candidate)
    }
  }

  private release(element: HTMLElement) {
    element.removeAttribute(FUSED_ATTRIBUTE)
    for (const name of HIGHLIGHT_VARIABLES) element.style.removeProperty(name)
  }

  private draw(path: string) {
    if (path === this.path) return
    this.path = path
    this.lens.style.clipPath = path ? `path('${path}')` : ''
    this.lens.toggleAttribute('data-active', path !== '')
    this.rim.setAttribute('d', path)
  }

  private tick = (now: number) => {
    this.frame = 0
    // 帧时间戳是这一帧开始的时刻，可能早于唤醒时记下的时间，间隔不能为负
    const dt = Math.max(0, (now - this.last) / 1000)
    this.last = now
    const { droplet, highlight, fusion } = this.options
    const reach = fusionReach(fusion)
    const k = fusionRadius(fusion)
    const { x, y } = this.pointer

    // 指针附近的形状：先用缓存的位置粗筛，再重新读取入选元素的实时位置
    const near: { candidate: Candidate; distance: number }[] = []
    if (this.present && !this.overText) {
      this.refreshCandidates(now)
      for (const candidate of this.candidates) {
        const distance = shapeDistance(candidate.shape, x, y)
        if (distance < reach * 1.25) near.push({ candidate, distance })
      }
      near.sort((a, b) => a.distance - b.distance)
      near.length = Math.min(near.length, MAX_ENGAGED)
    }
    const active = new Map<HTMLElement, { candidate: Candidate; distance: number }>()
    for (const entry of near) {
      const fresh = readCandidate(entry.candidate.element, true)
      if (!fresh || !entry.candidate.element.isConnected || !isOnTop(fresh)) continue
      const distance = shapeDistance(fresh.shape, x, y)
      if (distance < reach) active.set(fresh.element, { candidate: fresh, distance })
    }

    // 悬停的按钮微微鼓起，离开后缓缓收回；收回完成后才解除融合状态
    let growing = false
    for (const element of this.engaged.keys())
      if (!active.has(element)) {
        this.release(element)
        this.engaged.delete(element)
      }
    const shapes: GlassShape[] = []
    let inside = false
    for (const [element, { candidate, distance }] of active) {
      const hovered = distance <= 0
      inside ||= hovered
      const target = hovered ? (this.pressed ? 1 : 3.5) : 0
      const previous = this.engaged.get(element) ?? 0
      const eased = previous + (target - previous) * Math.min(1, dt * 14)
      // 接近目标后直接落到目标上，停下后轮廓不再有细微变化
      const grow = Math.abs(eased - target) > 0.05 ? eased : target
      if (grow !== target) growing = true
      this.engaged.set(element, grow)
      shapes.push({ ...candidate.shape, grow })
      if (droplet) element.setAttribute(FUSED_ATTRIBUTE, '')
      else element.removeAttribute(FUSED_ATTRIBUTE)
      if (highlight) {
        const px = ((x - candidate.left) / candidate.width) * 100
        const py = ((y - candidate.top) / candidate.height) * 100
        element.style.setProperty('--lg-px', px.toFixed(1) + '%')
        element.style.setProperty('--lg-py', py.toFixed(1) + '%')
        element.style.setProperty('--lg-glow', pullStrength(distance, reach).toFixed(3))
      } else {
        for (const name of HIGHLIGHT_VARIABLES) element.style.removeProperty(name)
      }
    }

    // 水滴被最近的形状吸过去；头部跟得紧，尾部跟得松，移动时自然拉成水滴形
    const target = attractPoint(this.pointer, shapes, reach)
    if (!this.placed && this.present) {
      this.placed = true
      this.dropX = this.tailX = { value: target.x, velocity: 0 }
      this.dropY = this.tailY = { value: target.y, velocity: 0 }
    }
    const visible = droplet && this.present && !this.overText
    const radiusTarget = !visible
      ? 0
      : this.pressed
        ? DROP_RADIUS * 0.7
        : inside
          ? DROP_RADIUS * 0.85
          : DROP_RADIUS
    this.dropX = stepSpring(this.dropX, target.x, 420, 30, dt)
    this.dropY = stepSpring(this.dropY, target.y, 420, 30, dt)
    this.tailX = stepSpring(this.tailX, this.dropX.value, 170, 19, dt)
    this.tailY = stepSpring(this.tailY, this.dropY.value, 170, 19, dt)
    this.radius = stepSpring(this.radius, radiusTarget, 300, 24, dt)
    const radius = Math.max(0, this.radius.value)

    if (droplet && (radius > 0.6 || shapes.length > 0)) {
      if (radius > 0.6) {
        shapes.push(circle(this.dropX.value, this.dropY.value, radius))
        shapes.push(circle(this.tailX.value, this.tailY.value, radius * 0.62))
      }
      this.lens.style.setProperty('--lg-cx', this.dropX.value.toFixed(1) + 'px')
      this.lens.style.setProperty('--lg-cy', this.dropY.value.toFixed(1) + 'px')
      this.draw(fusedPath(shapes, k, 3))
    } else {
      this.draw('')
    }

    const settled =
      springSettled(this.dropX, target.x) &&
      springSettled(this.dropY, target.y) &&
      springSettled(this.tailX, this.dropX.value) &&
      springSettled(this.tailY, this.dropY.value) &&
      springSettled(this.radius, radiusTarget)
    if (!this.present && settled) this.placed = false
    if (!settled || growing || (this.present && now - this.movedAt < IDLE_AFTER))
      this.frame = requestAnimationFrame(this.tick)
    else if (this.present) {
      this.stale = true
      this.heartbeat = window.setTimeout(this.wake, HEARTBEAT)
    }
  }
}
