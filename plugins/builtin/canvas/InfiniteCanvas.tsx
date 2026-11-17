import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { GripHorizontal, LayoutGrid, Map as MapIcon, Scan, ZoomIn, ZoomOut } from 'lucide-react'
import {
  EMPTY_CANVAS_STATE,
  INITIAL_VIEWPORT,
  boundsOf,
  centerOn,
  columnsFor,
  fitViewport,
  gridStep,
  packNodes,
  parseCanvasState,
  serializeCanvasState,
  visibleWorld,
  wheelZoomFactor,
  zoomAt,
  type CanvasState,
  type PackItem,
  type Point,
  type Rect,
  type Size,
  type Viewport,
} from './viewport'
import './style.css'

/** 画布上的一张卡片。content 由调用方创建，画布只负责摆放和测量。 */
export interface CanvasItem {
  id: string
  /** 卡片名称，用在移动手柄的无障碍标签里 */
  label: string
  /** 测量到实际高度之前用来排布的估计高度 */
  estimatedHeight: number
  /** 占几列，默认 1 */
  span?: number
  content: ReactNode
}

interface InfiniteCanvasProps {
  /** 区分不同页面的画布，视口和卡片位置按它分别保存在当前浏览器 */
  storageKey: string
  items: readonly CanvasItem[]
  columnWidth?: number
  gap?: number
}

const STORAGE_PREFIX = 'markvault:canvas:'
const MINIMAP_STORAGE_KEY = 'markvault:canvas_minimap'
const MINIMAP_SIZE = { width: 184, height: 124 }
/** 指针移动超过这个距离才算拖动，之内仍按点击处理。 */
const DRAG_THRESHOLD = 5
const KEYBOARD_STEP = 80
const NUDGE_STEP = 24
/** 从这些元素上按下时不平移画布：文本输入，以及标签页的拖动手柄（dnd-kit）。 */
const NO_PAN =
  'input, textarea, select, [contenteditable="true"], [aria-roledescription], [data-canvas-nopan]'

function loadState(storageKey: string): CanvasState {
  try {
    return parseCanvasState(window.localStorage.getItem(STORAGE_PREFIX + storageKey))
  } catch {
    return EMPTY_CANVAS_STATE
  }
}

function loadMinimap(): boolean {
  try {
    return window.localStorage.getItem(MINIMAP_STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

interface Gesture {
  mode: 'idle' | 'pending' | 'pan' | 'pinch' | 'node'
  pointers: Map<number, Point>
  pointerId: number
  startPointer: Point
  startViewport: Viewport
  startDistance: number
  startMid: Point
  node?: { id: string; origin: Point; moved: boolean }
}

/**
 * 无限画布：内容摆在一块不受屏幕大小限制的平面上，拖动平移、滚轮滚动、
 * Ctrl + 滚轮或双指捏合缩放。卡片默认按瀑布流自动排布，也可以拖着手柄自由摆放；
 * 视口和手动摆放的位置保存在当前浏览器。
 */
export function InfiniteCanvas({
  storageKey,
  items,
  columnWidth = 320,
  gap = 20,
}: InfiniteCanvasProps) {
  const { t } = useTranslation('plugins')
  const rootRef = useRef<HTMLDivElement>(null)
  const [initial] = useState(() => loadState(storageKey))
  const [viewport, setViewport] = useState<Viewport>(initial.viewport ?? INITIAL_VIEWPORT)
  const [positions, setPositions] = useState<Record<string, Point>>(initial.positions)
  const [heights, setHeights] = useState<Record<string, number>>({})
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  const [drag, setDrag] = useState<({ id: string } & Point) | null>(null)
  const [panning, setPanning] = useState(false)
  const [minimap, setMinimap] = useState(loadMinimap)

  // 卡片宽度固定，高度随内容变化：统一用一个观察器收集实际高度
  const [observer] = useState(() =>
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver((entries) => {
          setHeights((previous) => {
            let next = previous
            for (const entry of entries) {
              const element = entry.target as HTMLElement
              const id = element.dataset.nodeId
              const height = element.offsetHeight
              if (!id || height <= 0 || previous[id] === height) continue
              if (next === previous) next = { ...previous }
              next[id] = height
            }
            return next
          })
        })
  )
  useEffect(() => () => observer?.disconnect(), [observer])

  useEffect(() => {
    const root = rootRef.current
    if (!root || typeof ResizeObserver === 'undefined') return
    const measure = () => setSize({ width: root.clientWidth, height: root.clientHeight })
    measure()
    const resize = new ResizeObserver(measure)
    resize.observe(root)
    return () => resize.disconnect()
  }, [])

  // 手动摆放过的卡片留在原处，其余卡片自动排布并避开它们
  const layout = useMemo(() => {
    const widthOf = (span: number) => span * columnWidth + (span - 1) * gap
    const all: PackItem[] = items.map((item) => ({
      id: item.id,
      span: item.span,
      height: heights[item.id] ?? item.estimatedHeight,
    }))
    const pinned: Record<string, Rect> = {}
    for (const item of all) {
      const position = positions[item.id]
      if (position)
        pinned[item.id] = { ...position, width: widthOf(item.span ?? 1), height: item.height }
    }
    return {
      ...packNodes(
        all.filter((item) => !pinned[item.id]),
        {
          columnWidth,
          gap,
          // 列数按全部卡片估算，拖走一张卡片不会让其余卡片整体换列
          columns: columnsFor(all, { columnWidth, gap }),
          obstacles: Object.values(pinned),
        }
      ),
      ...pinned,
    }
  }, [items, heights, positions, columnWidth, gap])

  const rects = useMemo(
    () =>
      items.flatMap((item) => {
        const rect = layout[item.id]
        if (!rect) return []
        return [drag?.id === item.id ? { ...rect, x: drag.x, y: drag.y } : rect]
      }),
    [items, layout, drag]
  )

  // 事件处理里读取最新值，避免每次平移都重新绑定监听
  const live = useRef({ viewport, positions, layout, size, rects })
  live.current = { viewport, positions, layout, size, rects }

  const save = useCallback(() => {
    try {
      window.localStorage.setItem(
        STORAGE_PREFIX + storageKey,
        serializeCanvasState({
          viewport: live.current.viewport,
          positions: live.current.positions,
        })
      )
    } catch {
      // 存储不可用时只是下次进入回到初始视口
    }
  }, [storageKey])
  useEffect(() => {
    const timer = window.setTimeout(save, 250)
    return () => window.clearTimeout(timer)
  }, [viewport, positions, save])
  // 离开页面时把最后一次移动也存下来
  useEffect(() => save, [save])

  // 滚轮：默认滚动平移，按住 Ctrl / ⌘（触控板捏合也会带上 ctrlKey）时缩放。
  // React 的 onWheel 是被动监听，不能阻止页面滚动，所以直接绑定
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const box = root.getBoundingClientRect()
      if (event.ctrlKey || event.metaKey) {
        const point = { x: event.clientX - box.left, y: event.clientY - box.top }
        const factor = wheelZoomFactor(event.deltaY, event.deltaMode)
        setViewport((current) => zoomAt(current, point, current.scale * factor))
        return
      }
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? box.height : 1
      // 鼠标只有纵向滚轮时，按住 Shift 横向移动
      const sideways = event.shiftKey && event.deltaX === 0
      const dx = (sideways ? event.deltaY : event.deltaX) * unit
      const dy = (sideways ? 0 : event.deltaY) * unit
      setViewport((current) => ({ ...current, x: current.x - dx, y: current.y - dy }))
    }
    root.addEventListener('wheel', onWheel, { passive: false })
    return () => root.removeEventListener('wheel', onWheel)
  }, [])

  const gesture = useRef<Gesture>({
    mode: 'idle',
    pointers: new Map(),
    pointerId: -1,
    startPointer: { x: 0, y: 0 },
    startViewport: INITIAL_VIEWPORT,
    startDistance: 1,
    startMid: { x: 0, y: 0 },
  })
  // 拖动结束后浏览器还会补发一次 click，要拦下来，否则松手就会打开书签
  const suppressClick = useRef(false)

  const capture = (pointerId: number) => {
    try {
      rootRef.current?.setPointerCapture(pointerId)
    } catch {
      // 指针已经抬起时无法捕获，忽略
    }
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as Element
    suppressClick.current = false
    if (target.closest('[data-canvas-ui]')) return
    if (event.pointerType === 'mouse' && event.button !== 0 && event.button !== 1) return
    const state = gesture.current
    if (state.mode === 'node') return
    const handle = target.closest<HTMLElement>('[data-canvas-handle]')
    if (handle && event.button === 0 && state.mode === 'idle') {
      const id = handle.dataset.canvasHandle ?? ''
      const rect = live.current.layout[id]
      if (!rect) return
      state.mode = 'node'
      state.pointerId = event.pointerId
      state.startPointer = { x: event.clientX, y: event.clientY }
      state.node = { id, origin: { x: rect.x, y: rect.y }, moved: false }
      capture(event.pointerId)
      return
    }
    if (event.button === 0 && target.closest(NO_PAN)) return
    // 手指在画布外抬起时收不到抬起事件，上一次残留的触点会被误当成第二根手指
    if (state.mode === 'idle') state.pointers.clear()
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const [first, second] = [...state.pointers.values()]
    if (first && second) {
      // 第二根手指落下：改为捏合缩放
      const box = event.currentTarget.getBoundingClientRect()
      state.mode = 'pinch'
      state.startViewport = live.current.viewport
      state.startDistance = Math.max(1, Math.hypot(first.x - second.x, first.y - second.y))
      state.startMid = {
        x: (first.x + second.x) / 2 - box.left,
        y: (first.y + second.y) / 2 - box.top,
      }
      for (const pointerId of state.pointers.keys()) capture(pointerId)
      setPanning(true)
      return
    }
    state.startPointer = { x: event.clientX, y: event.clientY }
    state.startViewport = live.current.viewport
    if (event.button === 1) {
      state.mode = 'pan'
      capture(event.pointerId)
      setPanning(true)
    } else {
      state.mode = 'pending'
    }
  }

  const nodePosition = (state: Gesture, event: ReactPointerEvent<HTMLDivElement>): Point => {
    const scale = live.current.viewport.scale
    const origin = state.node?.origin ?? { x: 0, y: 0 }
    return {
      x: origin.x + (event.clientX - state.startPointer.x) / scale,
      y: origin.y + (event.clientY - state.startPointer.y) / scale,
    }
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = gesture.current
    const dx = event.clientX - state.startPointer.x
    const dy = event.clientY - state.startPointer.y
    if (state.mode === 'node') {
      if (event.pointerId !== state.pointerId || !state.node) return
      if (!state.node.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      state.node.moved = true
      setDrag({ id: state.node.id, ...nodePosition(state, event) })
      return
    }
    if (!state.pointers.has(event.pointerId)) return
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (state.mode === 'pinch') {
      const [first, second] = [...state.pointers.values()]
      if (!first || !second) return
      const box = event.currentTarget.getBoundingClientRect()
      const distance = Math.hypot(first.x - second.x, first.y - second.y)
      const mid = { x: (first.x + second.x) / 2 - box.left, y: (first.y + second.y) / 2 - box.top }
      const zoomed = zoomAt(
        state.startViewport,
        state.startMid,
        (state.startViewport.scale * distance) / state.startDistance
      )
      // 两指中点移动多少，画布跟着平移多少
      setViewport({
        scale: zoomed.scale,
        x: zoomed.x + mid.x - state.startMid.x,
        y: zoomed.y + mid.y - state.startMid.y,
      })
      return
    }
    if (state.mode === 'pending') {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      state.mode = 'pan'
      capture(event.pointerId)
      setPanning(true)
      window.getSelection()?.removeAllRanges()
    }
    if (state.mode === 'pan')
      setViewport({
        ...state.startViewport,
        x: state.startViewport.x + dx,
        y: state.startViewport.y + dy,
      })
  }

  const swallowNextClick = () => {
    suppressClick.current = true
    // 有些情况下不会补发 click（例如在画布外松手），稍后自动解除，免得误吞下一次键盘操作
    window.setTimeout(() => {
      suppressClick.current = false
    }, 80)
  }

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = gesture.current
    if (state.mode === 'node') {
      if (event.pointerId !== state.pointerId) return
      const node = state.node
      state.mode = 'idle'
      state.node = undefined
      if (node?.moved) {
        const position = nodePosition({ ...state, node }, event)
        setPositions((current) => ({ ...current, [node.id]: position }))
        swallowNextClick()
      }
      setDrag(null)
      return
    }
    if (!state.pointers.delete(event.pointerId)) return
    if (state.mode === 'pan' || state.mode === 'pinch') swallowNextClick()
    const [rest] = [...state.pointers.values()]
    if (rest) {
      // 捏合后还剩一根手指：接着平移
      state.mode = 'pan'
      state.startPointer = rest
      state.startViewport = live.current.viewport
    } else {
      state.mode = 'idle'
      setPanning(false)
    }
  }

  const zoomBy = useCallback((factor: number) => {
    const { width, height } = live.current.size
    setViewport((current) =>
      zoomAt(current, { x: width / 2, y: height / 2 }, current.scale * factor)
    )
  }, [])
  const resetZoom = useCallback(() => {
    const { width, height } = live.current.size
    setViewport((current) => zoomAt(current, { x: width / 2, y: height / 2 }, 1))
  }, [])
  const fit = useCallback(() => {
    setViewport(fitViewport(boundsOf(live.current.rects), live.current.size))
  }, [])
  const navigate = useCallback((world: Point) => {
    setViewport((current) => centerOn(current, world, live.current.size))
  }, [])
  const nudge = useCallback((id: string, dx: number, dy: number) => {
    const rect = live.current.layout[id]
    if (!rect) return
    setPositions((current) => ({ ...current, [id]: { x: rect.x + dx, y: rect.y + dy } }))
  }, [])
  const toggleMinimap = () => {
    const next = !minimap
    setMinimap(next)
    try {
      window.localStorage.setItem(MINIMAP_STORAGE_KEY, next ? 'on' : 'off')
    } catch {
      // 无法保存时仅本次生效
    }
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // 只处理焦点在画布本身时的按键，卡片里的输入框和按钮不受影响
    if (event.target !== event.currentTarget || event.ctrlKey || event.metaKey || event.altKey)
      return
    const pan = (dx: number, dy: number) =>
      setViewport((current) => ({ ...current, x: current.x + dx, y: current.y + dy }))
    if (event.key === 'ArrowLeft') pan(KEYBOARD_STEP, 0)
    else if (event.key === 'ArrowRight') pan(-KEYBOARD_STEP, 0)
    else if (event.key === 'ArrowUp') pan(0, KEYBOARD_STEP)
    else if (event.key === 'ArrowDown') pan(0, -KEYBOARD_STEP)
    else if (event.key === '+' || event.key === '=') zoomBy(1.25)
    else if (event.key === '-' || event.key === '_') zoomBy(0.8)
    else if (event.key === '0') fit()
    else if (event.key === '1') resetZoom()
    else return
    event.preventDefault()
  }

  const step = gridStep(viewport.scale)
  const arranged = items.some((item) => positions[item.id])
  const percent = Math.round(viewport.scale * 100)

  return (
    <div
      ref={rootRef}
      className="pcanvas"
      role="region"
      aria-label={t('canvas.label')}
      tabIndex={0}
      data-panning={panning ? 'true' : undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onClickCapture={(event) => {
        if (!suppressClick.current) return
        suppressClick.current = false
        event.preventDefault()
        event.stopPropagation()
      }}
      // 中键按下默认进入自动滚动，图片和链接默认可以被拖出去，两者都会打断平移
      onMouseDown={(event) => {
        if (event.button === 1) event.preventDefault()
      }}
      onDragStart={(event) => event.preventDefault()}
      // 用 Tab 把焦点移到画面外的卡片时，浏览器会滚动这个容器；改成平移画布
      onScroll={(event) => {
        const root = event.currentTarget
        const { scrollLeft, scrollTop } = root
        if (!scrollLeft && !scrollTop) return
        root.scrollLeft = 0
        root.scrollTop = 0
        setViewport((current) => ({
          ...current,
          x: current.x - scrollLeft,
          y: current.y - scrollTop,
        }))
      }}
      onKeyDown={handleKeyDown}
    >
      <div
        className="pcanvas__grid"
        aria-hidden="true"
        style={{
          backgroundSize: `${step}px ${step}px`,
          backgroundPosition: `${viewport.x}px ${viewport.y}px`,
        }}
      />
      <div
        className="pcanvas__world"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
        }}
      >
        {items.map((item) => {
          const rect = layout[item.id]
          if (!rect) return null
          const dragging = drag?.id === item.id
          return (
            <CanvasNode
              key={item.id}
              id={item.id}
              x={dragging ? drag.x : rect.x}
              y={dragging ? drag.y : rect.y}
              width={rect.width}
              dragging={dragging}
              gripLabel={t('canvas.moveCard', { name: item.label })}
              observer={observer}
              onNudge={nudge}
            >
              {item.content}
            </CanvasNode>
          )
        })}
      </div>

      <div className="pcanvas__hud" data-canvas-ui>
        <button
          type="button"
          onClick={() => zoomBy(0.8)}
          title={t('canvas.zoomOut')}
          aria-label={t('canvas.zoomOut')}
        >
          <ZoomOut size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="pcanvas__zoom"
          onClick={resetZoom}
          title={t('canvas.resetZoom')}
          aria-label={t('canvas.resetZoom') + ' ' + percent + '%'}
        >
          {percent}%
        </button>
        <button
          type="button"
          onClick={() => zoomBy(1.25)}
          title={t('canvas.zoomIn')}
          aria-label={t('canvas.zoomIn')}
        >
          <ZoomIn size={16} aria-hidden="true" />
        </button>
        <span className="pcanvas__divider" aria-hidden="true" />
        <button type="button" onClick={fit} title={t('canvas.fit')} aria-label={t('canvas.fit')}>
          <Scan size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => setPositions({})}
          disabled={!arranged}
          title={t('canvas.tidy')}
          aria-label={t('canvas.tidy')}
        >
          <LayoutGrid size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="pcanvas__minimap-toggle"
          onClick={toggleMinimap}
          aria-pressed={minimap}
          title={t('canvas.minimap')}
          aria-label={t('canvas.minimap')}
        >
          <MapIcon size={16} aria-hidden="true" />
        </button>
        <span className="pcanvas__hint">{t('canvas.hint')}</span>
      </div>

      {minimap && (
        <Minimap
          rects={rects}
          viewport={viewport}
          size={size}
          onNavigate={navigate}
          label={t('canvas.minimap')}
        />
      )}
    </div>
  )
}

interface CanvasNodeProps {
  id: string
  x: number
  y: number
  width: number
  dragging: boolean
  gripLabel: string
  observer: ResizeObserver | null
  onNudge: (id: string, dx: number, dy: number) => void
  children: ReactNode
}

/** 卡片的外框：定位、测量高度，并提供移动手柄。平移和缩放时属性不变，不会重新渲染。 */
const CanvasNode = memo(function CanvasNode({
  id,
  x,
  y,
  width,
  dragging,
  gripLabel,
  observer,
  onNudge,
  children,
}: CanvasNodeProps) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = ref.current
    if (!element || !observer) return
    observer.observe(element)
    return () => observer.unobserve(element)
  }, [observer])
  return (
    <div
      ref={ref}
      className="pcanvas__node"
      data-node-id={id}
      data-dragging={dragging ? 'true' : undefined}
      style={{ width, transform: `translate(${x}px, ${y}px)` }}
    >
      <button
        type="button"
        className="pcanvas__grip"
        data-canvas-handle={id}
        title={gripLabel}
        aria-label={gripLabel}
        onKeyDown={(event) => {
          const delta =
            event.key === 'ArrowLeft'
              ? [-NUDGE_STEP, 0]
              : event.key === 'ArrowRight'
                ? [NUDGE_STEP, 0]
                : event.key === 'ArrowUp'
                  ? [0, -NUDGE_STEP]
                  : event.key === 'ArrowDown'
                    ? [0, NUDGE_STEP]
                    : null
          if (!delta) return
          event.preventDefault()
          onNudge(id, delta[0]!, delta[1]!)
        }}
      >
        <GripHorizontal size={14} aria-hidden="true" />
      </button>
      {children}
    </div>
  )
})

interface MinimapProps {
  rects: readonly Rect[]
  viewport: Viewport
  size: Size
  onNavigate: (world: Point) => void
  label: string
}

/** 右下角的小地图：全部卡片的缩略位置和当前视口，点击或拖动可以直接跳过去。 */
const Minimap = memo(function Minimap({ rects, viewport, size, onNavigate, label }: MinimapProps) {
  if (rects.length === 0 || size.width <= 0 || size.height <= 0) return null
  const view = visibleWorld(viewport, size)
  // 视口移出内容范围时地图跟着扩大，视口框始终可见
  const bounds = boundsOf([...rects, view])
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null
  const ratio = Math.min(MINIMAP_SIZE.width / bounds.width, MINIMAP_SIZE.height / bounds.height)
  const go = (event: ReactPointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    onNavigate({
      x: bounds.x + (event.clientX - box.left) / ratio,
      y: bounds.y + (event.clientY - box.top) / ratio,
    })
  }
  return (
    <svg
      className="pcanvas__minimap"
      data-canvas-ui
      role="img"
      aria-label={label}
      width={bounds.width * ratio}
      height={bounds.height * ratio}
      viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        go(event)
      }}
      onPointerMove={(event) => {
        if (event.buttons) go(event)
      }}
    >
      {rects.map((rect, index) => (
        <rect
          key={index}
          className="pcanvas__minimap-node"
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={rect.height}
          rx={3 / ratio}
        />
      ))}
      <rect
        className="pcanvas__minimap-view"
        x={view.x}
        y={view.y}
        width={view.width}
        height={view.height}
        rx={2 / ratio}
      />
    </svg>
  )
})
