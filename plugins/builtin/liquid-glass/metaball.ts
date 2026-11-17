/**
 * 液态玻璃的融球（Metaball）计算，不依赖 DOM，融合图层、设置页演示和测试共用。
 *
 * 做法与 Liquid Glass 的形状融合一致：每个按钮或水滴是一个圆角矩形的有向距离场（SDF），
 * 用平滑最小值把它们并在一起。两个形状离得远时互不影响；间隙小于融合半径的一半时，
 * 它们之间长出一段细颈，越近越粗，最后合成一个形状；拉开时细颈先被拉长再断开。
 * 轮廓用 marching squares 在零等值线上取出，再连成平滑的闭合路径。
 */

export interface Point {
  x: number
  y: number
}

/** 圆角矩形：中心、半宽、半高和圆角半径。圆是半宽、半高都等于半径的特例。 */
export interface GlassShape {
  cx: number
  cy: number
  hw: number
  hh: number
  radius: number
  /** 向外膨胀的像素，悬停时让形状微微鼓起 */
  grow?: number
}

export function circle(x: number, y: number, r: number): GlassShape {
  return { cx: x, cy: y, hw: r, hh: r, radius: r }
}

/** 由左上角与尺寸构造形状，圆角不超过短边的一半。 */
export function roundRect(
  left: number,
  top: number,
  width: number,
  height: number,
  radius: number,
  grow = 0
): GlassShape {
  const hw = width / 2
  const hh = height / 2
  return {
    cx: left + hw,
    cy: top + hh,
    hw,
    hh,
    radius: Math.max(0, Math.min(radius, hw, hh)),
    grow,
  }
}

/** 点到形状边缘的有向距离：外部为正，内部为负。 */
export function shapeDistance(shape: GlassShape, x: number, y: number): number {
  const qx = Math.abs(x - shape.cx) - (shape.hw - shape.radius)
  const qy = Math.abs(y - shape.cy) - (shape.hh - shape.radius)
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
  return outside + Math.min(Math.max(qx, qy), 0) - shape.radius - (shape.grow ?? 0)
}

/**
 * 多项式平滑最小值。k 是融合半径：两个距离相差不到 k 时结果比两者都小，
 * 等值线因此向外鼓出，在两个形状之间连成一段细颈。k 不大于 0 时退化为普通最小值。
 */
export function smoothMin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b)
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}

/** 全部形状融合后的距离场，小于 0 的地方是玻璃。 */
export function fieldAt(shapes: readonly GlassShape[], x: number, y: number, k: number): number {
  let value = Infinity
  for (const shape of shapes) {
    const distance = shapeDistance(shape, x, y)
    value = value === Infinity ? distance : smoothMin(value, distance, k)
  }
  return value
}

/** 间隙小于这个值的两个形状会连在一起（两者中点处的场值恰好为 0）。 */
export function bridgeGap(k: number): number {
  return Math.max(0, k) / 2
}

export interface Bounds extends Point {
  width: number
  height: number
}

export function shapeBounds(shapes: readonly GlassShape[], margin = 0): Bounds | null {
  if (shapes.length === 0) return null
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const shape of shapes) {
    const grow = shape.grow ?? 0
    left = Math.min(left, shape.cx - shape.hw - grow)
    top = Math.min(top, shape.cy - shape.hh - grow)
    right = Math.max(right, shape.cx + shape.hw + grow)
    bottom = Math.max(bottom, shape.cy + shape.hh + grow)
  }
  return {
    x: left - margin,
    y: top - margin,
    width: right - left + margin * 2,
    height: bottom - top + margin * 2,
  }
}

/** 取样点数的上限，形状铺得太开时自动放大格子，保证一帧内算得完。 */
const MAX_SAMPLES = 60000

/**
 * 取出融合后的轮廓：每条轮廓是一圈闭合的点。
 * cell 是取样格子的边长，越小越平滑；点落在格子边上，由两端的场值线性插值得到。
 */
export function traceContours(shapes: readonly GlassShape[], k: number, cell = 4): Point[][] {
  const bounds = shapeBounds(shapes, Math.max(0, k) + cell * 2)
  if (!bounds || !(bounds.width > 0) || !(bounds.height > 0)) return []
  let size = Math.max(1, cell)
  while (((bounds.width / size) | 0) * ((bounds.height / size) | 0) > MAX_SAMPLES) size *= 1.5
  const cols = Math.ceil(bounds.width / size)
  const rows = Math.ceil(bounds.height / size)
  const stride = cols + 1
  const values = new Float32Array(stride * (rows + 1))
  for (let j = 0; j <= rows; j++)
    for (let i = 0; i <= cols; i++)
      // 边界一律算作外部，轮廓必然闭合
      values[j * stride + i] =
        i === 0 || j === 0 || i === cols || j === rows
          ? 1
          : fieldAt(shapes, bounds.x + i * size, bounds.y + j * size, k)

  // 格子的边编号：偶数是横边（从该点向右），奇数是竖边（从该点向下）
  const points = new Map<number, Point>()
  const links = new Map<number, number[]>()
  const horizontal = (i: number, j: number) => {
    const key = (j * stride + i) * 2
    if (!points.has(key)) {
      const a = values[j * stride + i]!
      const b = values[j * stride + i + 1]!
      points.set(key, { x: bounds.x + (i + a / (a - b)) * size, y: bounds.y + j * size })
    }
    return key
  }
  const vertical = (i: number, j: number) => {
    const key = (j * stride + i) * 2 + 1
    if (!points.has(key)) {
      const a = values[j * stride + i]!
      const b = values[(j + 1) * stride + i]!
      points.set(key, { x: bounds.x + i * size, y: bounds.y + (j + a / (a - b)) * size })
    }
    return key
  }
  const link = (from: number, to: number) => {
    const a = links.get(from)
    if (a) a.push(to)
    else links.set(from, [to])
    const b = links.get(to)
    if (b) b.push(from)
    else links.set(to, [from])
  }

  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const tl = values[j * stride + i]!
      const tr = values[j * stride + i + 1]!
      const br = values[(j + 1) * stride + i + 1]!
      const bl = values[(j + 1) * stride + i]!
      const index = (tl < 0 ? 8 : 0) | (tr < 0 ? 4 : 0) | (br < 0 ? 2 : 0) | (bl < 0 ? 1 : 0)
      if (index === 0 || index === 15) continue
      const top = () => horizontal(i, j)
      const right = () => vertical(i + 1, j)
      const bottom = () => horizontal(i, j + 1)
      const left = () => vertical(i, j)
      // 对角两点在内部时有两种连法，按格子中心在不在内部决定
      const joined = (index === 5 || index === 10) && (tl + tr + br + bl) / 4 < 0
      switch (index) {
        case 1:
        case 14:
          link(left(), bottom())
          break
        case 2:
        case 13:
          link(bottom(), right())
          break
        case 3:
        case 12:
          link(left(), right())
          break
        case 4:
        case 11:
          link(top(), right())
          break
        case 6:
        case 9:
          link(top(), bottom())
          break
        case 7:
        case 8:
          link(top(), left())
          break
        case 5:
          if (joined) {
            link(top(), left())
            link(bottom(), right())
          } else {
            link(top(), right())
            link(left(), bottom())
          }
          break
        case 10:
          if (joined) {
            link(top(), right())
            link(left(), bottom())
          } else {
            link(top(), left())
            link(bottom(), right())
          }
          break
      }
    }

  const loops: Point[][] = []
  const visited = new Set<number>()
  for (const start of links.keys()) {
    if (visited.has(start)) continue
    const loop: Point[] = []
    let current: number | undefined = start
    while (current !== undefined) {
      visited.add(current)
      loop.push(points.get(current)!)
      current = links.get(current)?.find((next) => !visited.has(next))
    }
    if (loop.length >= 3) loops.push(loop)
  }
  return loops
}

/** 轮廓围住的面积（鞋带公式），用来判断两个形状是否已经合成一个。 */
export function loopArea(loop: readonly Point[]): number {
  let area = 0
  for (let index = 0; index < loop.length; index++) {
    const a = loop[index]!
    const b = loop[(index + 1) % loop.length]!
    area += a.x * b.y - b.x * a.y
  }
  return Math.abs(area) / 2
}

const fixed = (value: number) => String(Math.round(value * 10) / 10)

/**
 * 把轮廓转成 SVG 路径：以各点为控制点、相邻两点的中点为端点画二次曲线，
 * 折线的棱角被抹平，可直接用于 clip-path: path() 和 <path d>。
 */
export function contourPath(loops: readonly (readonly Point[])[]): string {
  let path = ''
  for (const loop of loops) {
    const count = loop.length
    if (count < 3) continue
    const last = loop[count - 1]!
    const first = loop[0]!
    path += `M${fixed((last.x + first.x) / 2)} ${fixed((last.y + first.y) / 2)}`
    for (let index = 0; index < count; index++) {
      const point = loop[index]!
      const next = loop[(index + 1) % count]!
      path += `Q${fixed(point.x)} ${fixed(point.y)} ${fixed((point.x + next.x) / 2)} ${fixed((point.y + next.y) / 2)}`
    }
    path += 'Z'
  }
  return path
}

/** 融合后的轮廓路径；没有形状时返回空字符串。 */
export function fusedPath(shapes: readonly GlassShape[], k: number, cell = 4): string {
  return contourPath(traceContours(shapes, k, cell))
}

/** 形状边缘在某一点的朝外方向，由距离场的梯度得到。 */
export function shapeNormal(shape: GlassShape, x: number, y: number): Point {
  const dx = shapeDistance(shape, x + 0.5, y) - shapeDistance(shape, x - 0.5, y)
  const dy = shapeDistance(shape, x, y + 0.5) - shapeDistance(shape, x, y - 0.5)
  const length = Math.hypot(dx, dy)
  return length > 1e-6 ? { x: dx / length, y: dy / length } : { x: 0, y: -1 }
}

/** 吸附力度：刚进入范围时为 0，贴上边缘时为 1，越近增长越快。 */
export function pullStrength(distance: number, reach: number): number {
  if (!(reach > 0) || distance >= reach) return 0
  if (distance <= 0) return 1
  const closeness = 1 - distance / reach
  return closeness * closeness
}

/**
 * 指针水滴被附近的形状吸过去后的位置。
 * 指针离最近的形状不到 reach 时，水滴朝它的边缘靠拢，越近吸得越紧；指针已在形状内部时水滴跟随指针。
 */
export function attractPoint(
  pointer: Point,
  shapes: readonly GlassShape[],
  reach: number,
  strength = 0.85
): Point {
  let nearest: GlassShape | undefined
  let distance = Infinity
  for (const shape of shapes) {
    const candidate = shapeDistance(shape, pointer.x, pointer.y)
    if (candidate < distance) {
      distance = candidate
      nearest = shape
    }
  }
  if (!nearest || distance <= 0 || distance >= reach) return pointer
  const normal = shapeNormal(nearest, pointer.x, pointer.y)
  const shift = distance * pullStrength(distance, reach) * strength
  return { x: pointer.x - normal.x * shift, y: pointer.y - normal.y * shift }
}

/**
 * 两颗水滴互相吸引：返回各自朝对方移动的位移。
 * 间隙越小吸得越紧，已经贴上或重叠时不再继续靠拢，避免完全重合成一个圆。
 */
export function mutualPull(a: GlassShape, b: GlassShape, reach: number): [Point, Point] {
  const dx = b.cx - a.cx
  const dy = b.cy - a.cy
  const distance = Math.hypot(dx, dy)
  const gap = distance - a.radius - b.radius
  const none: [Point, Point] = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ]
  if (distance < 1e-6 || gap <= 0 || gap >= reach) return none
  const shift = (gap / 2) * pullStrength(gap, reach)
  const ux = dx / distance
  const uy = dy / distance
  return [
    { x: ux * shift, y: uy * shift },
    { x: -ux * shift, y: -uy * shift },
  ]
}

export interface Spring {
  value: number
  velocity: number
}

/**
 * 弹簧推进一步（半隐式欧拉）。阻尼略小于临界值时会有轻微回弹，是水滴“颤一下”的来源。
 * dt 的单位是秒，过大的步长先封顶，切换标签页回来不会飞出去。
 */
export function stepSpring(
  spring: Spring,
  target: number,
  stiffness: number,
  damping: number,
  dt: number
): Spring {
  const step = Math.min(Math.max(dt, 0), 1 / 30)
  const velocity =
    spring.velocity + ((target - spring.value) * stiffness - spring.velocity * damping) * step
  return { value: spring.value + velocity * step, velocity }
}

/** 弹簧是否已经停在目标上。 */
export function springSettled(spring: Spring, target: number, epsilon = 0.05): boolean {
  return Math.abs(spring.value - target) < epsilon && Math.abs(spring.velocity) < epsilon * 4
}
