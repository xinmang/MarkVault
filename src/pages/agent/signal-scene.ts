import { AsciiRenderer } from '../../../plugins/builtin/ocean/engine/renderer'
import { World } from '../../../plugins/builtin/ocean/engine/world'

export interface SignalScene {
  configure(paused: boolean, still: boolean): void
  replay(): void
  destroy(): void
}

/** 同一个模拟贯穿开场与循环，扫描完成时无需切换画面。 */
export function createSignalScene(canvas: HTMLCanvasElement): SignalScene {
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas unavailable')
  const ctx = context
  const source = document.createElement('canvas')
  const renderer = new AsciiRenderer(source, true)
  const world = new World(
    [
      { kind: 'classic', size: 1.35 },
      { kind: 'hammerhead', size: 0.75 },
    ],
    52
  )
  const width = 700
  const height = 450
  renderer.resize(width, height, 1)
  world.resize(width, height, renderer.cellWidth, renderer.cellHeight)
  for (let i = 0; i < 180; i++) world.step(1 / 60)
  const subject = world.sharks[world.sharks.length - 1]
  let elapsed = 0
  let previous = 0
  let frameId = 0
  let paused = false
  let still = false
  let visible = true
  let disposed = false
  let accent = '#7ee9d5'
  let surface = '#080f14'
  let scale = 1

  // 展示窗口采用缓慢的局部巡游，避免整页背景中的追逐逻辑把主体带出首屏。
  function keepSubjectsInFrame() {
    world.sharks.forEach((shark, index) => {
      const main = shark === subject
      const t = world.time * 0.22 + index * 2
      const headX = width * (main ? 0.64 : 0.78) + Math.sin(t) * 32
      const headY = height * (main ? 0.42 : 0.76) + Math.cos(t) * 22
      const angle = -0.22 + Math.sin(t * 0.65) * 0.22
      for (let node = 0; node < shark.nodes.length / 2; node++) {
        const distance = (node / (shark.nodes.length / 2 - 1)) * shark.length
        const sway = Math.sin(world.time * 2 - node * 0.35) * node * 0.45
        shark.nodes[node * 2] = headX - Math.cos(angle) * distance
        shark.nodes[node * 2 + 1] = headY - Math.sin(angle) * distance + sway
      }
    })
  }
  keepSubjectsInFrame()
  let originX = subject?.nodes[0] ?? width / 2
  let originY = subject?.nodes[1] ?? height / 2

  function draw() {
    const time = still ? 10 : elapsed
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    ctx.fillStyle = surface
    ctx.fillRect(0, 0, width, height)
    ctx.font = '12px Consolas, monospace'
    ctx.textBaseline = 'middle'
    const subject = world.sharks[world.sharks.length - 1]
    const x = subject?.nodes[0] ?? width / 2
    const y = subject?.nodes[1] ?? height / 2

    if (time >= 1) {
      renderer.render(world, paused || still ? 0 : 1 / 30)
      ctx.save()
      if (time < 4.5) {
        ctx.beginPath()
        ctx.arc(originX, originY, Math.max(0, (time - 1) / 3.5) * 750, 0, Math.PI * 2)
        ctx.clip()
      }
      ctx.globalAlpha = time < 5 ? 0.65 : 1
      ctx.filter = 'brightness(1.8)'
      ctx.drawImage(source, 0, 0)
      ctx.filter = 'none'
      if (time < 5) {
        // 两次短暂横移仅发生在画布内，不闪烁整页。
        if ((time > 2.6 && time < 2.72) || (time > 4.1 && time < 4.22)) {
          ctx.drawImage(source, 0, 175, width, 32, 12, 175, width, 32)
        }
        ctx.fillStyle = accent
        ctx.globalAlpha = 0.65
        for (let row = 0; row < 24; row++) {
          const gx = (row * 89 + Math.floor(time * 13) * 23) % width
          const gy = (row * 53) % height
          ctx.fillText('·:-=+↑#▪'[(row + Math.floor(time * 8)) % 8]!, gx, gy)
        }
      }
      ctx.restore()
    }

    // 对角扫描在 8.3 秒完成，后续仍由同一世界和同一时间轴继续绘制。
    if (time >= 5 && time < 8.3) {
      const scan = ((time - 5) / 3.3) * (width + height + 90) - 45
      ctx.save()
      ctx.beginPath()
      ctx.moveTo(scan, 0)
      ctx.lineTo(scan - height, height)
      ctx.lineTo(width, height)
      ctx.lineTo(width, 0)
      ctx.closePath()
      ctx.clip()
      ctx.fillStyle = surface
      ctx.globalAlpha = 0.7
      ctx.fillRect(0, 0, width, height)
      ctx.restore()
      ctx.fillStyle = accent
      for (let row = 0; row < height; row += 15) ctx.fillRect(scan - row, row, 6, 6)
    }

    ctx.strokeStyle = accent
    ctx.fillStyle = accent
    ctx.lineWidth = 1
    if (time < 5) {
      ctx.globalAlpha = Math.max(0, Math.min(1, 5 - time))
      const messages = ['> ASCII//LOOP', '> LOAD SOURCE ... OK', '> LOCK SUBJECT_01']
      messages.forEach((message, i) => {
        ctx.fillText(message.slice(0, Math.max(0, Math.floor(time * 65) - i * 22)), 26, 30 + i * 22)
      })
      if (Math.floor(time * 2) % 2 === 0) ctx.fillRect(26, 91, 7, 12)
      ctx.beginPath()
      ctx.moveTo(originX - 12, originY)
      ctx.lineTo(originX + 12, originY)
      ctx.moveTo(originX, originY - 12)
      ctx.lineTo(originX, originY + 12)
      ctx.stroke()
    } else {
      ctx.globalAlpha = 0.5
      const tx = Math.max(45, Math.min(width - 150, x))
      const ty = Math.max(80, Math.min(height - 60, y))
      ctx.strokeRect(tx - 12, ty - 12, 24, 24)
      ctx.beginPath()
      ctx.moveTo(tx + 12, ty)
      ctx.lineTo(tx + 42, ty - 24)
      ctx.lineTo(tx + 110, ty - 24)
      ctx.stroke()
      ctx.fillText('SUBJECT_01', tx + 45, ty - 36)
      ctx.globalAlpha = 0.35
      for (let i = 0; i < 7; i++) {
        ctx.fillText('↗', 35 + i * 22, height - 40 - Math.sin(world.time + i * 0.4) * 9)
      }
    }
    ctx.globalAlpha = 1
  }

  function frame(now: number) {
    if (disposed || paused || still || document.hidden || !visible) return
    if (!previous) previous = now
    const delta = now - previous
    if (delta >= 1000 / 30) {
      const dt = Math.min(delta / 1000, 0.1)
      elapsed += dt
      // 开场先锁定主体；扩散与最终循环共用同一个模拟。
      if (elapsed > 5) {
        world.step(dt)
        keepSubjectsInFrame()
      }
      draw()
      previous = now
    }
    frameId = requestAnimationFrame(frame)
  }

  function schedule() {
    cancelAnimationFrame(frameId)
    previous = 0
    if (!disposed && !paused && !still && !document.hidden && visible)
      frameId = requestAnimationFrame(frame)
  }

  function resize() {
    const bounds = canvas.getBoundingClientRect()
    scale = (Math.min(window.devicePixelRatio || 1, 1.5) * bounds.width) / width
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    draw()
  }

  function palette() {
    const style = getComputedStyle(canvas)
    accent = style.getPropertyValue('--agent-signal').trim() || '#7ee9d5'
    surface = style.getPropertyValue('--agent-screen').trim() || '#080f14'
    draw()
  }
  const resizeObserver = new ResizeObserver(resize)
  const themeObserver = new MutationObserver(palette)
  const intersectionObserver = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? false
    schedule()
  })
  resizeObserver.observe(canvas)
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-color-theme', 'data-theme', 'data-experimental-ui', 'style'],
  })
  intersectionObserver.observe(canvas)
  document.addEventListener('visibilitychange', schedule)
  palette()
  resize()

  return {
    configure(nextPaused, nextStill) {
      paused = nextPaused
      still = nextStill
      if (still) elapsed = 10
      draw()
      schedule()
    },
    replay() {
      elapsed = 0
      originX = subject?.nodes[0] ?? width / 2
      originY = subject?.nodes[1] ?? height / 2
      paused = false
      draw()
      schedule()
    },
    destroy() {
      disposed = true
      cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
      themeObserver.disconnect()
      intersectionObserver.disconnect()
      document.removeEventListener('visibilitychange', schedule)
    },
  }
}
