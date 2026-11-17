import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PluginState } from '../shared/plugin-types'
import { PluginContext } from '../src/plugins/context'
import { PLUGIN_ICON_NAMES } from '../src/plugins/icons'
import {
  INITIAL_VIEWPORT,
  MAX_SCALE,
  MIN_SCALE,
  boundsOf,
  centerOn,
  clampScale,
  columnsFor,
  fitViewport,
  gridStep,
  packNodes,
  parseCanvasState,
  serializeCanvasState,
  toWorld,
  visibleWorld,
  wheelZoomFactor,
  zoomAt,
  type Rect,
} from '../plugins/builtin/canvas/viewport'
import { InfiniteCanvas } from '../plugins/builtin/canvas/InfiniteCanvas'
import { CanvasModeSettings } from '../plugins/builtin/canvas/CanvasModeSettings'
import zh from '../src/i18n/locales/zh-CN/plugins.json'
import en from '../src/i18n/locales/en/plugins.json'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'zh-CN' } }),
}))

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

function plugin(id: string, overrides: Partial<PluginState> = {}): PluginState {
  return {
    manifest: {
      id: 'markvault.' + id,
      name: id,
      version: '1.0.0',
      api: '^1.0.0',
      author: '测试',
      permissions: [],
      contributes: [],
    },
    origin: 'builtin',
    enabled: true,
    disabled: false,
    status: 'running',
    config: {},
    grants: [],
    revision: '1',
    ...overrides,
  }
}

/** 键的路径集合，用来确认两种语言的文案结构一致。 */
function keyPaths(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object') return [prefix]
  return Object.entries(value).flatMap(([key, child]) =>
    keyPaths(child, prefix ? prefix + '.' + key : key)
  )
}

describe('无限画布的视口换算', () => {
  it('倍率收进允许范围，无效值回到原始大小', () => {
    expect(clampScale(1)).toBe(1)
    expect(clampScale(0)).toBe(MIN_SCALE)
    expect(clampScale(99)).toBe(MAX_SCALE)
    expect(clampScale(Number.NaN)).toBe(1)
    expect(clampScale(Number.POSITIVE_INFINITY)).toBe(1)
  })

  it('以一点为中心缩放时，该点下方的内容保持不动', () => {
    const viewport = { x: 40, y: -30, scale: 0.8 }
    const point = { x: 300, y: 200 }
    const before = toWorld(viewport, point)
    for (const scale of [0.25, 1, 2]) {
      const zoomed = zoomAt(viewport, point, scale)
      expect(zoomed.scale).toBe(scale)
      const after = toWorld(zoomed, point)
      expect(after.x).toBeCloseTo(before.x, 6)
      expect(after.y).toBeCloseTo(before.y, 6)
    }
    // 超出范围的倍率先收进范围再换算
    expect(zoomAt(viewport, point, 100).scale).toBe(MAX_SCALE)
  })

  it('滚轮向上放大、向下缩小，位移封顶，按行滚动换算成像素', () => {
    expect(wheelZoomFactor(0)).toBe(1)
    expect(wheelZoomFactor(-30)).toBeGreaterThan(1)
    expect(wheelZoomFactor(30)).toBeLessThan(1)
    expect(wheelZoomFactor(-30) * wheelZoomFactor(30)).toBeCloseTo(1, 9)
    expect(wheelZoomFactor(-5000)).toBe(wheelZoomFactor(-60))
    expect(wheelZoomFactor(2, 1)).toBe(wheelZoomFactor(32))
  })

  it('露出的世界范围随平移和倍率变化', () => {
    expect(visibleWorld({ x: -100, y: 50, scale: 2 }, { width: 800, height: 600 })).toEqual({
      x: 50,
      y: -25,
      width: 400,
      height: 300,
    })
  })

  it('外接矩形包住全部卡片，没有卡片时为空', () => {
    expect(boundsOf([])).toBeNull()
    expect(
      boundsOf([
        { x: 10, y: 20, width: 100, height: 50 },
        { x: -40, y: 60, width: 30, height: 200 },
      ])
    ).toEqual({ x: -40, y: 20, width: 150, height: 240 })
  })

  it('适应内容：整体放进画布并居中，内容较小时不放大', () => {
    const container = { width: 1000, height: 600 }
    const big: Rect = { x: 100, y: 50, width: 4000, height: 1000 }
    const fitted = fitViewport(big, container, 50)
    expect(fitted.scale).toBeCloseTo(900 / 4000, 9)
    const view = visibleWorld(fitted, container)
    // 内容中心落在画布中心，四周都在可见范围内
    expect(view.x + view.width / 2).toBeCloseTo(big.x + big.width / 2, 6)
    expect(view.y + view.height / 2).toBeCloseTo(big.y + big.height / 2, 6)
    expect(view.x).toBeLessThanOrEqual(big.x)
    expect(view.x + view.width).toBeGreaterThanOrEqual(big.x + big.width)

    const small = fitViewport({ x: 0, y: 0, width: 200, height: 100 }, container)
    expect(small).toEqual({ scale: 1, x: 400, y: 250 })
    expect(fitViewport(null, container)).toBe(INITIAL_VIEWPORT)
    expect(fitViewport(big, { width: 0, height: 0 })).toBe(INITIAL_VIEWPORT)
    // 内容极多时倍率不低于下限
    expect(fitViewport({ x: 0, y: 0, width: 1e6, height: 1e6 }, container).scale).toBe(MIN_SCALE)
  })

  it('小地图跳转：把世界里的一点移到画布中央，倍率不变', () => {
    const container = { width: 800, height: 600 }
    const moved = centerOn({ x: 0, y: 0, scale: 0.5 }, { x: 1000, y: 400 }, container)
    expect(moved.scale).toBe(0.5)
    expect(toWorld(moved, { x: 400, y: 300 })).toEqual({ x: 1000, y: 400 })
  })

  it('网点间距跟随倍率，缩得很小时成倍放大而不密成一片', () => {
    expect(gridStep(1)).toBe(24)
    expect(gridStep(2)).toBe(48)
    for (const scale of [MIN_SCALE, 0.2, 0.33, 0.5, 0.66])
      expect(gridStep(scale)).toBeGreaterThanOrEqual(16)
    expect(gridStep(0.25)).toBe(24)
  })
})

describe('无限画布的卡片排布', () => {
  const options = { columnWidth: 300, gap: 20 }

  it('列数按内容多少估算：内容越多画布越宽，不受屏幕宽度限制', () => {
    const cards = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ id: String(index), height: 300 }))
    expect(columnsFor([], options)).toBe(1)
    const few = columnsFor(cards(4), options)
    const many = columnsFor(cards(200), options)
    expect(few).toBeGreaterThanOrEqual(2)
    expect(many).toBeGreaterThan(few)
    // 两百张卡片排出来的整幅画布接近横向比例，而不是一条长列
    const bounds = boundsOf(Object.values(packNodes(cards(200), options)))!
    expect(bounds.width).toBeGreaterThan(1920)
    expect(bounds.width / bounds.height).toBeGreaterThan(1)
    expect(bounds.width / bounds.height).toBeLessThan(2.4)
    // 跨列的卡片至少占得下
    expect(columnsFor([{ id: 'wide', height: 10, span: 3 }], options)).toBe(3)
  })

  it('瀑布流：依次放进最短的一列，跨列卡片占一段连续的列', () => {
    const layout = packNodes(
      [
        { id: 'tags', height: 100, span: 2 },
        { id: 'a', height: 400 },
        { id: 'b', height: 50 },
        { id: 'c', height: 50 },
      ],
      { ...options, columns: 3 }
    )
    expect(layout.tags).toEqual({ x: 0, y: 0, width: 620, height: 100 })
    // 第三列还空着，a 放到最右
    expect(layout.a).toEqual({ x: 640, y: 0, width: 300, height: 400 })
    expect(layout.b).toEqual({ x: 0, y: 120, width: 300, height: 50 })
    expect(layout.c).toEqual({ x: 320, y: 120, width: 300, height: 50 })
    // 列数不足时跨列卡片收窄到全部列
    expect(packNodes([{ id: 'x', height: 10, span: 5 }], { ...options, columns: 2 }).x!.width).toBe(
      620
    )
  })

  it('自动排布的卡片互不重叠，并避开手动摆放的卡片', () => {
    const obstacles: Rect[] = [{ x: 250, y: 30, width: 300, height: 200 }]
    const items = Array.from({ length: 30 }, (_, index) => ({
      id: String(index),
      height: 60 + ((index * 37) % 180),
      span: index % 7 === 0 ? 2 : 1,
    }))
    const rects = Object.values(packNodes(items, { ...options, columns: 4, obstacles }))
    expect(rects).toHaveLength(30)
    const overlaps = (a: Rect, b: Rect) =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
    for (const [index, rect] of rects.entries()) {
      expect(overlaps(rect, obstacles[0]!)).toBe(false)
      for (const other of rects.slice(index + 1)) expect(overlaps(rect, other)).toBe(false)
    }
  })
})

describe('无限画布的状态保存', () => {
  it('视口和手动位置往返一致，倍率收进范围', () => {
    const state = {
      viewport: { x: -120.456, y: 33.333, scale: 0.75 },
      positions: { 'tag:1': { x: 640, y: -80.129 }, tags: { x: 0, y: 0 } },
    }
    expect(parseCanvasState(serializeCanvasState(state))).toEqual({
      viewport: { x: -120.46, y: 33.33, scale: 0.75 },
      positions: { 'tag:1': { x: 640, y: -80.13 }, tags: { x: 0, y: 0 } },
    })
    expect(parseCanvasState(serializeCanvasState({ viewport: null, positions: {} }))).toEqual({
      viewport: null,
      positions: {},
    })
    expect(parseCanvasState('{"v":[0,0,50],"p":{}}').viewport?.scale).toBe(MAX_SCALE)
  })

  it('内容损坏或字段不对时忽略对应部分', () => {
    const empty = { viewport: null, positions: {} }
    for (const raw of [null, undefined, '', '不是 JSON', 'null', '42', '[]'])
      expect(parseCanvasState(raw)).toEqual(empty)
    expect(
      parseCanvasState(
        JSON.stringify({ v: [1, 'x', 1], p: { ok: [1, 2], bad: [1], text: 'no', nan: [null, 2] } })
      )
    ).toEqual({ viewport: null, positions: { ok: { x: 1, y: 2 } } })
    expect(parseCanvasState('{"v":[1,2,1],"p":[[1,2]]}')).toEqual({
      viewport: { x: 1, y: 2, scale: 1 },
      positions: {},
    })
  })
})

describe('无限画布的界面与接入', () => {
  it('画布渲染全部卡片、移动手柄、缩放控件和操作说明', () => {
    const html = renderToStaticMarkup(
      <InfiniteCanvas
        storageKey="test"
        items={[
          { id: 'a', label: '甲', estimatedHeight: 100, content: <p>卡片甲</p> },
          { id: 'b', label: '乙', estimatedHeight: 100, span: 2, content: <p>卡片乙</p> },
        ]}
      />
    )
    expect(html).toMatch(/class="pcanvas"[^>]*role="region"[^>]*aria-label="canvas\.label"/)
    expect(html).toMatch(/class="pcanvas"[^>]*tabindex="0"/)
    expect(html).toContain('卡片甲')
    expect(html).toContain('卡片乙')
    expect(html.match(/data-canvas-handle="/g)).toHaveLength(2)
    expect(html).toContain('width:320px')
    // 占两列的卡片宽度是两列加一个间距
    expect(html).toContain('width:660px')
    for (const key of ['zoomIn', 'zoomOut', 'resetZoom', 'fit', 'tidy', 'minimap', 'hint'])
      expect(html).toContain('canvas.' + key)
    // 没有手动摆放过的卡片时“重新整理”不可用
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*title="canvas\.tidy"/)
    expect(html).toContain('100%')
  })

  it('设置里的开关：首页与标签页组各一个，反映当前是否使用无限画布', () => {
    const render = (plugins: PluginState[], safe = false) =>
      renderToStaticMarkup(
        <PluginContext.Provider
          value={{
            directory: { plugins, admin: false, apiVersion: '1.0.0', runtimeAvailable: true },
            ready: true,
            safe,
            refresh: async () => undefined,
          }}
        >
          <CanvasModeSettings />
        </PluginContext.Provider>
      )
    const row = (html: string, page: string) =>
      html.slice(html.indexOf(`data-canvas-page="${page}"`)).split('data-canvas-page="')[1]!

    const off = render([
      plugin('home-canvas', { enabled: false, status: 'disabled' }),
      plugin('tabs-canvas', { enabled: false, status: 'disabled' }),
    ])
    expect(off).toContain('canvas.settings.title')
    expect(off.match(/type="checkbox"/g)).toHaveLength(2)
    expect(off).not.toContain('checked=""')
    expect(off).not.toContain('disabled=""')

    // 只开启了首页画布
    const home = render([
      plugin('home-canvas'),
      plugin('tabs-canvas', { enabled: false, status: 'disabled' }),
    ])
    expect(row(home, 'home')).toContain('checked=""')
    expect(row(home, 'tabs')).not.toContain('checked=""')

    // 被全实例停用或目录里没有对应插件时不能切换
    const blocked = render([plugin('home-canvas', { disabled: true, status: 'disabled' })])
    expect(row(blocked, 'home')).toContain('disabled=""')
    expect(row(blocked, 'home')).toContain('shells.picker.unavailable')
    expect(row(blocked, 'tabs')).toContain('disabled=""')

    // 安全模式下页面使用默认版式，开关不可操作并说明原因
    const safe = render([plugin('home-canvas'), plugin('tabs-canvas')], true)
    expect(safe).toContain('shells.picker.safe')
    expect(safe.match(/disabled=""/g)).toHaveLength(2)
  })

  it('两个画布版式登记为按需启用的内置插件，图标与两种语言的文案齐全', () => {
    const go = read('../plugins/builtins.go')
    for (const id of ['home-canvas', 'tabs-canvas']) {
      const line = go.split('\n').find((item) => item.includes(`{id: "${id}"`))
      expect(line, id).toBeTruthy()
      expect(line).toContain('icon: "infinity"')
      expect(line).toContain('optIn: true')
      expect(line).toContain('category: "appearance"')
    }
    expect(PLUGIN_ICON_NAMES).toContain('infinity')
    expect(keyPaths(zh.canvas)).toEqual(keyPaths(en.canvas))
    for (const locale of [zh, en]) {
      expect(locale.canvas.settings.title).toBeTruthy()
      expect(locale.canvas.settings.home.name).toBeTruthy()
      expect(locale.canvas.settings.tabs.name).toBeTruthy()
      expect(locale.canvas.moveCard).toContain('{{name}}')
      expect(locale.canvas.settings.toggle).toContain('{{name}}')
    }
    // 设置页在页面版式选择器上方放无限画布开关
    const page = read('../src/pages/settings/GeneralSettingsPage.tsx')
    expect(page.indexOf('<CanvasModeSettings />')).toBeGreaterThan(0)
    expect(page.indexOf('<CanvasModeSettings />')).toBeLessThan(page.indexOf('<ShellPicker />'))
  })
})
