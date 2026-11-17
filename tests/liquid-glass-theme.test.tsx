import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  attractPoint,
  bridgeGap,
  circle,
  contourPath,
  fieldAt,
  fusedPath,
  loopArea,
  mutualPull,
  pullStrength,
  roundRect,
  shapeBounds,
  shapeDistance,
  shapeNormal,
  smoothMin,
  springSettled,
  stepSpring,
  traceContours,
  type Spring,
} from '../plugins/builtin/liquid-glass/metaball'
import {
  DEFAULT_LIQUID_GLASS_CONFIG,
  GLASS_TARGETS,
  LIQUID_GLASS_FROST_RANGE,
  LIQUID_GLASS_FUSION_RANGE,
  fusionRadius,
  fusionReach,
  resolveLiquidGlassConfig,
} from '../plugins/builtin/liquid-glass/settings'
import { ThemeSettingsTab } from '../src/components/settings/tabs/ThemeSettingsTab'
import { getBuiltinNavigation } from '../src/plugins/navigation'
import { PLUGIN_ICON_NAMES } from '../src/plugins/icons'
import zhSettings from '../src/i18n/locales/zh-CN/settings.json'
import enSettings from '../src/i18n/locales/en/settings.json'
import zhPlugins from '../src/i18n/locales/zh-CN/plugins.json'
import enPlugins from '../src/i18n/locales/en/plugins.json'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('液态玻璃的距离场', () => {
  it('有向距离：外部为正、内部为负，圆角处按圆弧计算', () => {
    const ball = circle(100, 100, 20)
    expect(shapeDistance(ball, 100, 100)).toBeCloseTo(-20, 9)
    expect(shapeDistance(ball, 120, 100)).toBeCloseTo(0, 9)
    expect(shapeDistance(ball, 150, 100)).toBeCloseTo(30, 9)
    expect(shapeDistance(ball, 130, 140)).toBeCloseTo(30, 9)

    const pill = roundRect(0, 0, 100, 40, 8)
    expect(pill).toMatchObject({ cx: 50, cy: 20, hw: 50, hh: 20, radius: 8 })
    expect(shapeDistance(pill, 50, 20)).toBeCloseTo(-20, 9)
    expect(shapeDistance(pill, 50, -10)).toBeCloseTo(10, 9)
    expect(shapeDistance(pill, 110, 20)).toBeCloseTo(10, 9)
    // 直角的角点恰好在圆角矩形之外：离圆弧 8·(√2 − 1)
    expect(shapeDistance(pill, 0, 0)).toBeCloseTo(8 * (Math.SQRT2 - 1), 9)
    // 圆角不超过短边的一半，胶囊的端点是半圆
    expect(roundRect(0, 0, 100, 40, 999).radius).toBe(20)
    expect(roundRect(0, 0, 100, 40, -3).radius).toBe(0)
    // 悬停时向外鼓起
    expect(shapeDistance({ ...pill, grow: 3 }, 110, 20)).toBeCloseTo(7, 9)
  })

  it('平滑最小值：离得远时等于普通最小值，接近时比两者都小', () => {
    expect(smoothMin(5, 80, 30)).toBe(5)
    expect(smoothMin(80, 5, 30)).toBe(5)
    expect(smoothMin(10, 10, 30)).toBeCloseTo(10 - 30 / 4, 9)
    expect(smoothMin(10, 16, 30)).toBeLessThan(10)
    expect(smoothMin(10, 16, 30)).toBe(smoothMin(16, 10, 30))
    expect(smoothMin(3, 7, 0)).toBe(3)
    expect(smoothMin(3, 7, -5)).toBe(3)
  })

  it('融合后的场：单个形状就是它自己的距离，没有形状时处处在外', () => {
    const ball = circle(0, 0, 10)
    expect(fieldAt([ball], 25, 0, 30)).toBeCloseTo(15, 9)
    expect(fieldAt([], 0, 0, 30)).toBe(Infinity)
    // 两颗水滴的正中间：间隙小于融合半径的一半时场值为负，已经连上
    const pair = (gap: number) => [circle(-10 - gap / 2, 0, 10), circle(10 + gap / 2, 0, 10)]
    expect(bridgeGap(30)).toBe(15)
    expect(bridgeGap(-4)).toBe(0)
    expect(fieldAt(pair(15), 0, 0, 30)).toBeCloseTo(0, 9)
    expect(fieldAt(pair(10), 0, 0, 30)).toBeLessThan(0)
    expect(fieldAt(pair(20), 0, 0, 30)).toBeGreaterThan(0)
  })

  it('外接范围包含鼓起的部分和留白', () => {
    expect(shapeBounds([])).toBeNull()
    expect(shapeBounds([circle(0, 0, 10), { ...roundRect(20, -5, 40, 10, 5), grow: 2 }], 4)).toEqual(
      { x: -14, y: -14, width: 80, height: 28 }
    )
  })
})

describe('液态玻璃的融球轮廓', () => {
  const k = 30
  const pair = (gap: number) => [circle(100, 100, 24), circle(148 + gap, 100, 24)]

  it('单颗水滴取出一圈闭合轮廓，面积接近圆面积', () => {
    const loops = traceContours([circle(100, 100, 24)], k, 2)
    expect(loops).toHaveLength(1)
    const area = loopArea(loops[0]!)
    expect(area).toBeGreaterThan(Math.PI * 24 * 24 * 0.97)
    expect(area).toBeLessThan(Math.PI * 24 * 24 * 1.01)
    // 轮廓上的点都落在水滴边缘附近
    for (const point of loops[0]!)
      expect(Math.abs(Math.hypot(point.x - 100, point.y - 100) - 24)).toBeLessThan(0.6)
    expect(traceContours([], k)).toEqual([])
  })

  it('两颗水滴离得远时各自独立，靠近后拉丝连成一个形状，再拉开又断开', () => {
    const apart = traceContours(pair(40), k, 2)
    expect(apart).toHaveLength(2)
    const single = Math.PI * 24 * 24
    for (const loop of apart) expect(loopArea(loop)).toBeLessThan(single * 1.02)

    // 间隙小于融合半径的一半：中间长出细颈，只剩一圈轮廓
    const fused = traceContours(pair(6), k, 2)
    expect(fused).toHaveLength(1)
    // 细颈和鼓出的部分让面积超过两颗水滴之和
    expect(loopArea(fused[0]!)).toBeGreaterThan(single * 2)
    // 轮廓经过两颗水滴之间：存在落在间隙里的点
    const inGap = fused[0]!.filter((point) => point.x > 126 && point.x < 152)
    expect(inGap.length).toBeGreaterThan(4)
    // 细颈比水滴细：间隙里的轮廓离中轴不超过水滴半径
    for (const point of inGap) expect(Math.abs(point.y - 100)).toBeLessThan(24)

    // 越近细颈越粗
    const neck = (gap: number) => -fieldAt(pair(gap), 124 + gap / 2, 100, k)
    expect(neck(2)).toBeGreaterThan(neck(6))
    expect(neck(6)).toBeGreaterThan(neck(12))
    expect(neck(bridgeGap(k) + 4)).toBeLessThan(0)
    expect(traceContours(pair(bridgeGap(k) + 6), k, 2)).toHaveLength(2)
  })

  it('融合范围为 0 时不拉丝，相邻但不接触的形状保持独立', () => {
    expect(traceContours(pair(4), 0, 2)).toHaveLength(2)
    expect(traceContours(pair(4), k, 2)).toHaveLength(1)
  })

  it('水滴与按钮融合：圆和胶囊连成一个形状', () => {
    const button = roundRect(100, 100, 120, 36, 18)
    const drop = circle(160, 80, 12)
    expect(shapeDistance(button, 160, 92)).toBeCloseTo(8, 9)
    expect(traceContours([button, drop], k, 2)).toHaveLength(1)
    expect(traceContours([button, circle(160, 40, 12)], k, 2)).toHaveLength(2)
  })

  it('轮廓转成可用于 clip-path 的闭合路径', () => {
    expect(contourPath([])).toBe('')
    expect(
      contourPath([
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
      ])
    ).toBe('M0 5Q0 0 5 0Q10 0 10 5Q10 10 5 10Q0 10 0 5Z')
    // 不足三个点围不成形状
    expect(
      contourPath([
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      ])
    ).toBe('')
    const path = fusedPath(pair(6), k, 3)
    expect(path).toMatch(/^M[-\d. ]+(Q[-\d. ]+)+Z$/)
    expect(fusedPath(pair(40), k, 3).match(/Z/g)).toHaveLength(2)
    expect(fusedPath([], k)).toBe('')
    // 形状铺得很开时自动放大取样格子，仍然算得出轮廓
    expect(traceContours([circle(0, 0, 40), circle(6000, 4000, 40)], k, 2)).toHaveLength(2)
  })
})

describe('液态玻璃的吸附与弹簧', () => {
  it('吸附力度：范围外为 0，贴上边缘为 1，越近增长越快', () => {
    expect(pullStrength(64, 64)).toBe(0)
    expect(pullStrength(100, 64)).toBe(0)
    expect(pullStrength(0, 64)).toBe(1)
    expect(pullStrength(-5, 64)).toBe(1)
    expect(pullStrength(32, 64)).toBeCloseTo(0.25, 9)
    expect(pullStrength(16, 64)).toBeGreaterThan(pullStrength(32, 64) * 2)
    expect(pullStrength(10, 0)).toBe(0)
  })

  it('指针水滴靠近按钮时被吸向按钮边缘，在按钮内部或范围之外跟随指针', () => {
    const button = roundRect(100, 100, 120, 36, 18)
    const reach = 64
    const pointer = { x: 160, y: 80 }
    const pulled = attractPoint(pointer, [button], reach)
    // 正上方：只沿竖直方向被吸过去，仍在按钮之外
    expect(pulled.x).toBeCloseTo(160, 6)
    expect(pulled.y).toBeGreaterThan(80)
    expect(shapeDistance(button, pulled.x, pulled.y)).toBeGreaterThan(0)
    expect(shapeDistance(button, pulled.x, pulled.y)).toBeLessThan(20)
    // 越近吸得越多（按占剩余距离的比例）
    const share = (y: number) => (attractPoint({ x: 160, y }, [button], reach).y - y) / (100 - y)
    expect(share(90)).toBeGreaterThan(share(60))
    expect(attractPoint({ x: 160, y: 118 }, [button], reach)).toEqual({ x: 160, y: 118 })
    expect(attractPoint({ x: 160, y: 10 }, [button], reach)).toEqual({ x: 160, y: 10 })
    expect(attractPoint(pointer, [], reach)).toBe(pointer)
    // 多个形状时吸向最近的一个
    const other = roundRect(100, 0, 120, 36, 18)
    expect(attractPoint({ x: 160, y: 45 }, [button, other], reach).y).toBeLessThan(45)
    expect(shapeNormal(button, 160, 80)).toEqual({ x: 0, y: -1 })
    expect(shapeNormal(button, 160, 118)).toEqual({ x: 0, y: -1 })
  })

  it('两颗水滴互相吸引：位移大小相等、方向相反，不会吸到重叠', () => {
    const a = circle(0, 0, 20)
    const b = circle(60, 0, 20)
    const [da, db] = mutualPull(a, b, 64)
    expect(da.x).toBeGreaterThan(0)
    expect(da.x).toBeCloseTo(-db.x, 9)
    expect(da.y).toBeCloseTo(0, 9)
    expect(db.y).toBeCloseTo(0, 9)
    // 间隙 20：各自最多走一半
    expect(da.x).toBeLessThan(10)
    const zero = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ]
    expect(mutualPull(a, circle(200, 0, 20), 64)).toEqual(zero)
    expect(mutualPull(a, circle(30, 0, 20), 64)).toEqual(zero)
    expect(mutualPull(a, circle(0, 0, 20), 64)).toEqual(zero)
    // 越近吸得越紧
    const closing = (gap: number) => mutualPull(a, circle(40 + gap, 0, 20), 64)[0].x / (gap / 2)
    expect(closing(8)).toBeGreaterThan(closing(30))
  })

  it('弹簧收敛到目标并带一点回弹，过大的步长被封顶', () => {
    let spring: Spring = { value: 0, velocity: 0 }
    let peak = 0
    for (let frame = 0; frame < 240; frame++) {
      spring = stepSpring(spring, 100, 170, 19, 1 / 60)
      peak = Math.max(peak, spring.value)
    }
    expect(springSettled(spring, 100)).toBe(true)
    expect(spring.value).toBeCloseTo(100, 1)
    // 阻尼小于临界值：先冲过目标一点再回来
    expect(peak).toBeGreaterThan(100)
    expect(peak).toBeLessThan(112)
    expect(springSettled({ value: 0, velocity: 0 }, 100)).toBe(false)
    expect(springSettled({ value: 100, velocity: 3 }, 100)).toBe(false)
    const start = { value: 0, velocity: 0 }
    expect(stepSpring(start, 100, 170, 19, 5)).toEqual(stepSpring(start, 100, 170, 19, 1 / 30))
    expect(stepSpring(start, 100, 170, 19, -1)).toEqual(start)
  })
})

describe('液态玻璃主题的选项与接入', () => {
  it('缺失或无效的配置回到默认值，数值收进允许范围', () => {
    expect(resolveLiquidGlassConfig()).toEqual(DEFAULT_LIQUID_GLASS_CONFIG)
    expect(resolveLiquidGlassConfig(null)).toEqual(DEFAULT_LIQUID_GLASS_CONFIG)
    expect(resolveLiquidGlassConfig({})).toEqual(DEFAULT_LIQUID_GLASS_CONFIG)
    expect(
      resolveLiquidGlassConfig({ droplet: false, highlight: false, frost: 30, fusion: 140 })
    ).toEqual({ droplet: false, highlight: false, frost: 30, fusion: 140 })
    expect(
      resolveLiquidGlassConfig({ droplet: 'no', highlight: 0, frost: Number.NaN, fusion: '120' })
    ).toEqual(DEFAULT_LIQUID_GLASS_CONFIG)
    expect(resolveLiquidGlassConfig({ frost: 999 }).frost).toBe(LIQUID_GLASS_FROST_RANGE.max)
    expect(resolveLiquidGlassConfig({ frost: -1 }).frost).toBe(LIQUID_GLASS_FROST_RANGE.min)
    expect(resolveLiquidGlassConfig({ fusion: 999 }).fusion).toBe(LIQUID_GLASS_FUSION_RANGE.max)
    expect(resolveLiquidGlassConfig({ fusion: 1 }).fusion).toBe(LIQUID_GLASS_FUSION_RANGE.min)
    expect(resolveLiquidGlassConfig({ frost: 12.6 }).frost).toBe(13)
    // 解析不会改写默认值
    expect(DEFAULT_LIQUID_GLASS_CONFIG).toEqual({
      droplet: true,
      highlight: true,
      frost: 18,
      fusion: 100,
    })
  })

  it('融合范围按百分比缩放融合半径和吸附距离', () => {
    expect(fusionRadius(100)).toBe(30)
    expect(fusionReach(100)).toBe(64)
    expect(fusionRadius(50)).toBe(15)
    expect(fusionReach(150)).toBe(96)
    // 吸附距离大于连上所需的间隙：水滴先被吸过去，再拉丝融合
    for (const fusion of [LIQUID_GLASS_FUSION_RANGE.min, 100, LIQUID_GLASS_FUSION_RANGE.max])
      expect(fusionReach(fusion)).toBeGreaterThan(bridgeGap(fusionRadius(fusion)))
  })

  it('前端默认值与内置清单的设置结构一致', () => {
    const go = read('../plugins/builtins.go')
    const schema = go.slice(go.indexOf('var liquidGlassSettings'), go.indexOf('var builtins'))
    for (const [key, value] of Object.entries(DEFAULT_LIQUID_GLASS_CONFIG)) {
      const line = schema.split('\n').find((item) => item.includes(`"${key}":`))
      expect(line, key).toBeTruthy()
      expect(line).toMatch(new RegExp(`"default":\\s*${String(value)}(\\.0)?[,}]`))
    }
    const range = (name: string, { min, max }: { min: number; max: number }) =>
      expect(schema.split('\n').find((item) => item.includes(`"${name}":`))).toContain(
        `"minimum": ${min}.0, "maximum": ${max}.0`
      )
    range('frost', LIQUID_GLASS_FROST_RANGE)
    range('fusion', LIQUID_GLASS_FUSION_RANGE)
    expect(go).toContain(
      'preference: "experimental_liquid_glass_theme_enabled", exclusive: InterfaceThemeGroup, settings: liquidGlassSettings'
    )
    expect(go).toMatch(/\{id: "liquid-glass",[^\n]*icon: "droplets"/)
    expect(PLUGIN_ICON_NAMES).toContain('droplets')
    expect(read('../internal/server/settings.go')).toContain(
      'experimental_liquid_glass_theme_enabled'
    )
    expect(read('../migrations/0134_liquid_glass_theme.sql')).toContain(
      'ADD COLUMN experimental_liquid_glass_theme_enabled INTEGER NOT NULL DEFAULT 0'
    )
  })

  it('归属主题外观，由界面主题选择器管理', () => {
    expect(getBuiltinNavigation('markvault.liquid-glass')).toEqual({
      category: 'appearance',
      section: 'theme',
      picker: true,
    })
  })

  it('主题样式限定在自己的作用域内，融合图层不拦截指针', () => {
    const css = read('../plugins/builtin/liquid-glass/style.css')
    const selectors = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('}')
      .map((block) => block.split('{')[0]!.trim())
      .filter((selector) => selector && !/^(@|from|to|\d+%)/.test(selector))
    // 只在括号外的逗号处拆分：:is(a, b:not(c)) 内部的逗号属于同一个选择器
    const topLevel = (selector: string) => {
      const parts: string[] = []
      let depth = 0
      let current = ''
      for (const char of selector) {
        if (char === '(') depth++
        else if (char === ')') depth--
        if (char === ',' && depth === 0) {
          parts.push(current)
          current = ''
        } else current += char
      }
      return [...parts, current]
    }
    expect(selectors.length).toBeGreaterThan(60)
    const stray = selectors.filter(
      (selector) =>
        !topLevel(selector).every((part) =>
          /data-experimental-ui='liquid-glass'|\.liquid-glass-|\.lg-/.test(part)
        )
    )
    expect(stray).toEqual([])
    expect(read('../src/styles/index.css')).toContain("@import './themes/liquid-glass.css'")
    expect(read('../src/styles/themes/liquid-glass.css')).toContain(
      'plugins/builtin/liquid-glass/style.css'
    )
    // 融合图层盖在页面上，但点击必须落到下面的按钮
    expect(css).toMatch(/\.lg-fusion \{[^}]*pointer-events: none/)
    // 磨砂强度来自选项写入的变量
    expect(css).toContain('--lg-filter: blur(var(--lg-frost))')
    expect(css).toContain('backdrop-filter: var(--lg-filter)')
    // 带前缀的声明必须写在前面：反过来写时，正式构建的压缩会只留下 -webkit-backdrop-filter，
    // Chromium 不认这个写法，玻璃就不再模糊背景
    const filters = [...css.matchAll(/^[ \t]*(-webkit-)?backdrop-filter: (.+);/gm)]
    expect(filters.length).toBeGreaterThan(0)
    expect(filters.length % 2).toBe(0)
    for (let index = 0; index < filters.length; index += 2) {
      expect(filters[index]![1]).toBe('-webkit-')
      expect(filters[index + 1]![1]).toBeUndefined()
      expect(filters[index + 1]![2]).toBe(filters[index]![2])
    }
    // 被融合的控件把描边让给融合图层
    expect(css).toContain("[data-lg-fused]")
    // 主题画成玻璃的控件都在融合名单里
    for (const target of ['.btn', '.tag-item', '.pshell-pill', '.settings-nav-item']) {
      expect(GLASS_TARGETS.split(', ')).toContain(target)
      expect(css).toContain(target)
    }
    // 尊重减少动态效果与减少透明度的系统设置
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toContain('@media (prefers-reduced-transparency: reduce)')
  })

  it('主题设置里多出液态玻璃选项，预览用融球滤镜展示两颗胶囊融合', () => {
    const render = (theme: 'default' | 'liquid-glass') =>
      renderToStaticMarkup(
        <ThemeSettingsTab interfaceTheme={theme} onInterfaceThemeChange={() => undefined} />
      )
    const html = render('liquid-glass')
    expect(html.match(/type="radio"/g)).toHaveLength(6)
    expect(html).toMatch(/interface-theme-card--selected[^>]*>\s*<input[^>]*value="liquid-glass"/)
    expect(html).toContain('liquid-glass-preview')
    expect(html).toContain('feGaussianBlur')
    expect(html).toContain('url(#liquid-glass-preview-goo)')
    expect(render('default')).not.toMatch(
      /checked=""[^>]*value="liquid-glass"|value="liquid-glass"[^>]*checked=""/
    )
    for (const locale of [zhSettings, enSettings]) {
      expect(locale.themeSettings.options['liquid-glass'].title).toBeTruthy()
      expect(locale.themeSettings.options['liquid-glass'].description).toBeTruthy()
    }
    for (const locale of [zhPlugins, enPlugins]) {
      expect(locale.summary['liquid-glass']).toBeTruthy()
      expect(locale.liquidGlass.options).toBeTruthy()
      expect(locale.liquidGlass.playground.hint).toBeTruthy()
      expect(locale.liquidGlass.playground.drop).toContain('{{index}}')
    }
  })
})
