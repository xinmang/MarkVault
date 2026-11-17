import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  circle,
  fusedPath,
  mutualPull,
  springSettled,
  stepSpring,
  type Point,
  type Spring,
} from './metaball'
import { fusionRadius, fusionReach } from './settings'

interface Drop {
  radius: number
  /** 松手后停留的位置 */
  anchor: Point
  x: Spring
  y: Spring
}

const RADII = [34, 26] as const
const KEY_STEP = 14

/**
 * 设置页里的融合演示：两颗玻璃水滴，拖动其中一颗靠近另一颗，
 * 它们会互相吸过去并融合成一个形状；再拉开，中间先拉出一段细颈再断开。
 * 与页面上按钮之间的融合使用同一套计算，融合范围跟随当前选项。
 * animated 为 false 时水滴直接跟随，不做弹簧回弹。
 */
export function LiquidGlassPlayground({
  fusion,
  animated,
}: {
  fusion: number
  animated: boolean
}) {
  const { t } = useTranslation('plugins')
  const stage = useRef<HTMLDivElement>(null)
  const lens = useRef<HTMLDivElement>(null)
  const rim = useRef<SVGPathElement>(null)
  const handles = useRef<(HTMLButtonElement | null)[]>([])
  const drops = useRef<Drop[]>([])
  const dragging = useRef<{ index: number; point: Point; offset: Point } | null>(null)
  const frame = useRef(0)
  const last = useRef(0)
  const settings = useRef({ fusion, animated })
  settings.current = { fusion, animated }
  // 只在挂载时创建一次，之后通过 ref 读取最新的选项
  const wake = useRef(() => {})

  useEffect(() => {
    const element = stage.current
    if (!element) return
    const size = () => ({ width: element.clientWidth, height: element.clientHeight })
    const clamp = (point: Point, radius: number): Point => {
      const { width, height } = size()
      return {
        x: Math.min(Math.max(point.x, radius), Math.max(radius, width - radius)),
        y: Math.min(Math.max(point.y, radius), Math.max(radius, height - radius)),
      }
    }

    const tick = (now: number) => {
      frame.current = 0
      const dt = (now - last.current) / 1000
      last.current = now
      const { fusion, animated } = settings.current
      const reach = fusionReach(fusion)
      const [a, b] = drops.current
      if (!a || !b) return
      const held = dragging.current
      // 互相吸引按“不受对方影响时”的位置计算，结果稳定，不会越吸越近
      const rest = drops.current.map((drop, index) =>
        clamp(held?.index === index ? held.point : drop.anchor, drop.radius)
      )
      const pulls = mutualPull(
        circle(rest[0]!.x, rest[0]!.y, a.radius),
        circle(rest[1]!.x, rest[1]!.y, b.radius),
        reach
      )
      let settled = true
      drops.current.forEach((drop, index) => {
        const target = clamp(
          { x: rest[index]!.x + pulls[index]!.x, y: rest[index]!.y + pulls[index]!.y },
          drop.radius
        )
        if (animated) {
          // 拖着的那颗跟得紧，另一颗松一些，被吸过去时会晃一下
          const stiffness = held?.index === index ? 520 : 150
          const damping = held?.index === index ? 36 : 13
          drop.x = stepSpring(drop.x, target.x, stiffness, damping, dt)
          drop.y = stepSpring(drop.y, target.y, stiffness, damping, dt)
        } else {
          drop.x = { value: target.x, velocity: 0 }
          drop.y = { value: target.y, velocity: 0 }
        }
        if (!springSettled(drop.x, target.x) || !springSettled(drop.y, target.y)) settled = false
        const handle = handles.current[index]
        if (handle)
          handle.style.transform = `translate(${drop.x.value - drop.radius}px, ${drop.y.value - drop.radius}px)`
      })
      const path = fusedPath(
        drops.current.map((drop) => circle(drop.x.value, drop.y.value, drop.radius)),
        fusionRadius(fusion) * 1.4,
        3
      )
      if (lens.current) lens.current.style.clipPath = `path('${path}')`
      rim.current?.setAttribute('d', path)
      if (!settled || held) frame.current = requestAnimationFrame(tick)
    }
    wake.current = () => {
      if (frame.current) return
      last.current = performance.now()
      frame.current = requestAnimationFrame(tick)
    }

    const place = () => {
      const { width, height } = size()
      if (width <= 0 || height <= 0) return
      if (drops.current.length === 0) {
        drops.current = RADII.map((radius, index) => {
          const anchor = { x: width * (index === 0 ? 0.3 : 0.7), y: height / 2 }
          return {
            radius,
            anchor,
            x: { value: anchor.x, velocity: 0 },
            y: { value: anchor.y, velocity: 0 },
          }
        })
      } else {
        for (const drop of drops.current) drop.anchor = clamp(drop.anchor, drop.radius)
      }
      wake.current()
    }
    place()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    observer?.observe(element)
    return () => {
      observer?.disconnect()
      if (frame.current) cancelAnimationFrame(frame.current)
      frame.current = 0
    }
  }, [])

  // 选项变化后重画一次
  useEffect(() => wake.current(), [fusion, animated])

  const local = (event: PointerEvent): Point => {
    const box = stage.current?.getBoundingClientRect()
    return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) }
  }
  const start = (index: number) => (event: PointerEvent<HTMLButtonElement>) => {
    const drop = drops.current[index]
    if (!drop) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = local(event)
    // 记住按下点与水滴中心的偏移，水滴不会在按下的瞬间跳到指针正下方
    const offset = { x: drop.x.value - point.x, y: drop.y.value - point.y }
    dragging.current = { index, offset, point: { x: drop.x.value, y: drop.y.value } }
    wake.current()
  }
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const held = dragging.current
    if (!held) return
    const point = local(event)
    held.point = { x: point.x + held.offset.x, y: point.y + held.offset.y }
  }
  const end = () => {
    const held = dragging.current
    const drop = held && drops.current[held.index]
    // 水滴留在松手的位置；离另一颗够近时两颗会继续吸在一起
    if (held && drop) drop.anchor = held.point
    dragging.current = null
    wake.current()
  }
  const nudge = (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const delta =
      event.key === 'ArrowLeft'
        ? [-KEY_STEP, 0]
        : event.key === 'ArrowRight'
          ? [KEY_STEP, 0]
          : event.key === 'ArrowUp'
            ? [0, -KEY_STEP]
            : event.key === 'ArrowDown'
              ? [0, KEY_STEP]
              : null
    const drop = drops.current[index]
    if (!delta || !drop) return
    event.preventDefault()
    drop.anchor = { x: drop.anchor.x + delta[0]!, y: drop.anchor.y + delta[1]! }
    wake.current()
  }

  return (
    <div className="lg-playground">
      <p className="lg-playground__hint">{t('liquidGlass.playground.hint')}</p>
      <div ref={stage} className="lg-playground__stage">
        <div className="lg-playground__backdrop" aria-hidden="true">
          <span>Liquid Glass</span>
          <span>Metaball · Morphing · Blending</span>
          <span>MarkVault</span>
        </div>
        <div ref={lens} className="lg-playground__lens" aria-hidden="true" />
        <svg className="lg-playground__rim" aria-hidden="true">
          <defs>
            <linearGradient id="lg-playground-rim" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#fff" stopOpacity="0.95" />
              <stop offset="0.45" stopColor="#fff" stopOpacity="0.2" />
              <stop offset="1" stopColor="#fff" stopOpacity="0.65" />
            </linearGradient>
          </defs>
          <path ref={rim} d="" />
        </svg>
        {RADII.map((radius, index) => (
          <button
            key={index}
            ref={(element) => {
              handles.current[index] = element
            }}
            type="button"
            className="lg-playground__handle"
            style={{ width: radius * 2, height: radius * 2 }}
            aria-label={t('liquidGlass.playground.drop', { index: index + 1 })}
            onPointerDown={start(index)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            onKeyDown={nudge(index)}
          />
        ))}
      </div>
    </div>
  )
}
