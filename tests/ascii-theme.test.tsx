import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  BOOT_LINES,
  BOOT_TIMELINE,
  GLITCH_WINDOWS,
  HORIZON,
  LUMA_RAMP,
  SCAN_BAND,
  bootPhase,
  bootTextAlpha,
  cellRevealAt,
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
} from '../plugins/builtin/ascii/scene'
import {
  FRAME_CELL,
  FRAME_PLAIN,
  FRAME_STRONG,
  FRAME_VARIABLES,
  frameImage,
  frameSvg,
  frameVariables,
} from '../plugins/builtin/ascii/frame'
import {
  ASCII_DENSITY_RANGE,
  DEFAULT_ASCII_CONFIG,
  resolveAsciiConfig,
} from '../plugins/builtin/ascii/settings'
import { ThemeSettingsTab } from '../src/components/settings/tabs/ThemeSettingsTab'
import { getBuiltinNavigation, getPluginCategory } from '../src/plugins/navigation'
import type { PluginState } from '../shared/plugin-types'
import zhSettings from '../src/i18n/locales/zh-CN/settings.json'
import enSettings from '../src/i18n/locales/en/settings.json'
import zhPlugins from '../src/i18n/locales/zh-CN/plugins.json'
import enPlugins from '../src/i18n/locales/en/plugins.json'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('ASCII 画面的字符与场景', () => {
  it('亮度从暗到亮映射到字符梯度，越界值收进两端', () => {
    expect(LUMA_RAMP.join('')).toBe(' ·:-=+↑#▪')
    expect(glyphFor(0)).toBe(' ')
    expect(glyphFor(1)).toBe('▪')
    expect(glyphFor(-3)).toBe(' ')
    expect(glyphFor(9)).toBe('▪')
    const indexes = Array.from({ length: 101 }, (_, i) => LUMA_RAMP.indexOf(glyphFor(i / 100)))
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b))
    expect(new Set(indexes).size).toBe(LUMA_RAMP.length)
  })

  it('伪随机数稳定且落在 0–1，乱码取自固定字符集', () => {
    expect(hash(3, 7, 2)).toBe(hash(3, 7, 2))
    expect(hash(3, 7, 2)).not.toBe(hash(7, 3, 2))
    for (let i = 0; i < 200; i++) {
      const value = hash(i, i * 31, i % 5)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
      expect(garbageGlyph(i, 3, 9)).toMatch(/^[\x21-\x7e]$/)
    }
  })

  it('场景分出天空、地平线、海面和树的剪影，亮度始终在 0–1', () => {
    expect(sampleScene(0.5, 0.1, 0).zone).toBe('sky')
    expect(sampleScene(0.5, HORIZON - 0.01, 0).zone).toBe('glow')
    expect(['sea', 'foam']).toContain(sampleScene(0.5, 0.9, 0).zone)
    // 树是一块暗色剪影：树冠和树干都不出字符
    expect(sampleScene(0.13, HORIZON - 0.2, 0)).toEqual({ luma: 0, zone: 'tree' })
    expect(sampleScene(0.13, HORIZON - 0.02, 4).zone).toBe('tree')
    const zones = new Set<string>()
    for (let y = 0; y < 40; y++)
      for (let x = 0; x < 80; x++) {
        const sample = sampleScene(x / 80, y / 40, 12.5)
        zones.add(sample.zone)
        expect(sample.luma).toBeGreaterThanOrEqual(0)
        expect(sample.luma).toBeLessThanOrEqual(1)
      }
    expect([...zones].sort()).toEqual(['foam', 'glow', 'sea', 'sky', 'tree'])
    // 海面随时间流动
    expect(sampleScene(0.4, 0.8, 0).luma).not.toBe(sampleScene(0.4, 0.8, 1.3).luma)
  })
})

describe('ASCII 启动序列的时间线', () => {
  it('依次经过打字、扩散、停留、扫描和揭开', () => {
    expect([0, 0.05, 0.1, 0.3, 0.45, 0.49, 0.5, 0.7, 0.83, 1].map(bootPhase)).toEqual([
      'type',
      'type',
      'spread',
      'spread',
      'hold',
      'hold',
      'scan',
      'scan',
      'done',
      'done',
    ])
  })

  it('启动信息逐字打出，在扫描开始前淡出', () => {
    const total = BOOT_LINES.reduce((sum, line) => sum + line.length, 0)
    expect(BOOT_LINES.every((line) => line.startsWith('> '))).toBe(true)
    expect(typedCharacters(0, total)).toBe(0)
    expect(typedCharacters(BOOT_TIMELINE.typeEnd, total)).toBe(total)
    const typed = Array.from({ length: 21 }, (_, i) => typedCharacters(i / 200, total))
    expect(typed).toEqual([...typed].sort((a, b) => a - b))
    expect(bootTextAlpha(0.2)).toBe(1)
    expect(bootTextAlpha(BOOT_TIMELINE.scanStart)).toBe(0)
  })

  it('字符从定位点向外扩散，先闪乱码再定格，扫描开始前铺满', () => {
    expect(cellRevealAt(0)).toBe(BOOT_TIMELINE.spreadStart)
    expect(cellRevealAt(0.2)).toBeLessThan(cellRevealAt(0.8))
    expect(cellStage(0.05, 0)).toBe('hidden')
    expect(cellStage(BOOT_TIMELINE.spreadStart + 0.01, 0)).toBe('garbage')
    expect(cellStage(BOOT_TIMELINE.spreadStart + 0.06, 0)).toBe('settled')
    expect(cellStage(0.2, 1)).toBe('hidden')
    // 最远的角也在扩散阶段结束前定格
    expect(cellStage(BOOT_TIMELINE.spreadEnd, 1)).toBe('settled')
  })

  it('扩散期间有两次短暂的横向错位', () => {
    expect(GLITCH_WINDOWS).toHaveLength(2)
    for (const [from, to] of GLITCH_WINDOWS) {
      expect(from).toBeGreaterThan(BOOT_TIMELINE.spreadStart)
      expect(to).toBeLessThan(BOOT_TIMELINE.spreadEnd)
      expect(glitchActive((from + to) / 2)).toBe(true)
    }
    expect(glitchActive(0.3)).toBe(false)
    expect(glitchActive(0.6)).toBe(false)
  })

  it('扫描带从左上斜向扫到右下，前沿是实心方块，扫过之处揭开界面', () => {
    expect(scanCoordinate(0, 0)).toBe(0)
    expect(scanCoordinate(1, 1)).toBe(1)
    expect(scanCoordinate(0.2, 0.6)).toBe(scanCoordinate(0.6, 0.2))
    // 开始时整幅画面还是字符，结束时连同带尾全部揭开
    expect(scanState(0, scanFront(BOOT_TIMELINE.scanStart), 0.02)).toBe('ascii')
    expect(scanState(1, scanFront(BOOT_TIMELINE.scanEnd), 0.02)).toBe('revealed')
    const front = scanFront((BOOT_TIMELINE.scanStart + BOOT_TIMELINE.scanEnd) / 2)
    expect(scanState(front + 0.01, front, 0.02)).toBe('ascii')
    expect(scanState(front - 0.01, front, 0.02)).toBe('edge')
    expect(scanState(front - SCAN_BAND / 2, front, 0.02)).toBe('band')
    expect(scanState(front - SCAN_BAND - 0.01, front, 0.02)).toBe('revealed')
    const fronts = Array.from({ length: 12 }, (_, i) => scanFront(0.5 + i * 0.03))
    expect(fronts).toEqual([...fronts].sort((a, b) => a - b))
  })
})

describe('ASCII 字符边框', () => {
  it('3×3 格的边框图：四角、上下边和左右边各放一个字符，中间留空', () => {
    const svg = frameSvg('#3a4a45')
    expect(svg).toContain(`width="${FRAME_CELL.width * 3}" height="${FRAME_CELL.height * 3}"`)
    expect(svg.match(/<text /g)).toHaveLength(8)
    expect(svg.match(/>\+</g)).toHaveLength(4)
    expect(svg.match(/>-</g)).toHaveLength(2)
    expect(svg.match(/>\|</g)).toHaveLength(2)
    expect(svg).toContain('fill="#3a4a45"')
    expect(frameSvg('#000', FRAME_STRONG).match(/>=</g)).toHaveLength(2)
    expect(FRAME_PLAIN).toEqual({ corner: '+', horizontal: '-', vertical: '|' })
  })

  it('颜色与字符都经过转义，生成的变量可以直接写进样式', () => {
    const svg = frameSvg('"><script>', { corner: '<', horizontal: '&', vertical: '"' })
    expect(svg).not.toContain('<script>')
    expect(svg).not.toMatch(/>[<&"]</)
    expect(frameImage('#3df2cf')).toMatch(/^url\("data:image\/svg\+xml,[^"]+"\)$/)
    const variables = frameVariables({ line: '#111111', accent: '#222222', ink: '#333333' })
    expect(Object.keys(variables)).toEqual([...FRAME_VARIABLES])
    expect(decodeURIComponent(variables['--ascii-frame'])).toContain('#111111')
    expect(decodeURIComponent(variables['--ascii-frame-strong'])).toContain('>=<')
    expect(decodeURIComponent(variables['--ascii-shade'])).toContain('#333333')
  })

  it('样式按边框图的格子尺寸切片，并用到脚本写入的每个变量', () => {
    const css = read('../plugins/builtin/ascii/style.css')
    const slice = `${FRAME_CELL.height} ${FRAME_CELL.width} / ${FRAME_CELL.height}px ${FRAME_CELL.width}px`
    expect(css).toContain(`border-image: var(--ascii-frame) ${slice} / 0 round`)
    for (const name of FRAME_VARIABLES) expect(css).toContain(`var(${name})`)
    // 按钮是方括号，开关是字符画
    expect(css).toContain("content: '[' !important")
    expect(css).toContain("content: '[o--]'")
    expect(css).toContain("content: '[--#]'")
    // 主题规则全部限定在自己的作用域内，不影响其他主题
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
    expect(topLevel('a, :is(b, c:not(d, e)), f').map((part) => part.trim())).toEqual([
      'a',
      ':is(b, c:not(d, e))',
      'f',
    ])
    const stray = selectors.filter(
      (selector) =>
        !topLevel(selector).every((part) =>
          /data-experimental-ui='ascii'|\.ascii-|^\s*(from|to|\d+%)/.test(part)
        )
    )
    expect(stray).toEqual([])
    expect(read('../src/styles/index.css')).toContain("@import './themes/ascii.css'")
  })
})

describe('ASCII 主题的选项与接入', () => {
  it('缺失或无效的配置回到默认值，密度收进允许范围', () => {
    expect(resolveAsciiConfig()).toEqual(DEFAULT_ASCII_CONFIG)
    expect(resolveAsciiConfig({})).toEqual(DEFAULT_ASCII_CONFIG)
    expect(
      resolveAsciiConfig({ boot: false, background: 'rain', scanlines: false, glitch: false, density: 120 })
    ).toEqual({ boot: false, background: 'rain', scanlines: false, glitch: false, density: 120 })
    expect(
      resolveAsciiConfig({ boot: 'no', background: 'matrix', density: Number.NaN, glitch: 0 })
    ).toEqual(DEFAULT_ASCII_CONFIG)
    expect(resolveAsciiConfig({ density: 9999 }).density).toBe(ASCII_DENSITY_RANGE.max)
    expect(resolveAsciiConfig({ density: -5 }).density).toBe(ASCII_DENSITY_RANGE.min)
    expect(resolveAsciiConfig({ density: 80.6 }).density).toBe(81)
  })

  it('前端默认值与内置清单的设置结构一致', () => {
    const go = read('../plugins/builtins.go')
    const schema = go.slice(go.indexOf('var asciiSettings'), go.indexOf('var builtins'))
    for (const [key, value] of Object.entries(DEFAULT_ASCII_CONFIG)) {
      const line = schema.split('\n').find((item) => item.includes(`"${key}":`))
      expect(line, key).toBeTruthy()
      const expected = typeof value === 'string' ? `"${value}"` : String(value)
      expect(line).toMatch(new RegExp(`"default":\\s*${expected.replace('.', '\\.')}(\\.0)?[,}]`))
    }
    expect(schema).toContain('"field", "rain", "off"')
    expect(schema).toMatch(/"minimum": 40\.0, "maximum": 160\.0/)
    expect(go).toContain('preference: "experimental_ascii_theme_enabled", exclusive: InterfaceThemeGroup')
    expect(read('../internal/server/settings.go')).toContain('experimental_ascii_theme_enabled')
    expect(read('../migrations/0133_ascii_theme.sql')).toContain('experimental_ascii_theme_enabled')
  })

  it('归属主题外观，由界面主题选择器管理；清单声明的分类优先于内置兜底', () => {
    expect(getBuiltinNavigation('markvault.ascii')).toEqual({
      category: 'appearance',
      section: 'theme',
      picker: true,
    })
    const plugin = (manifest: Partial<PluginState['manifest']>, origin: PluginState['origin']) =>
      ({
        manifest: { id: 'example.demo', contributes: [{ id: 'a', kind: 'tool', title: 'a' }], ...manifest },
        origin,
      }) as PluginState
    expect(getPluginCategory(plugin({ id: 'markvault.ascii' }, 'builtin'))).toBe('appearance')
    expect(getPluginCategory(plugin({ id: 'markvault.ascii', category: 'effects' }, 'builtin'))).toBe(
      'effects'
    )
    expect(getPluginCategory(plugin({ category: 'layouts' }, 'community'))).toBe('layouts')
    expect(getPluginCategory(plugin({}, 'community'))).toBe('intelligence')
    // 未知分类不会被采纳
    expect(getPluginCategory(plugin({ category: 'official' as never }, 'community'))).toBe(
      'intelligence'
    )
  })

  it('主题设置里多出 ASCII 终端选项，预览本身是字符画', () => {
    const render = (theme: 'default' | 'ascii') =>
      renderToStaticMarkup(<ThemeSettingsTab interfaceTheme={theme} onInterfaceThemeChange={() => undefined} />)
    const html = render('ascii')
    expect(html.match(/type="radio"/g)).toHaveLength(6)
    expect(html).toMatch(/interface-theme-card--selected[^>]*>\s*<input[^>]*value="ascii"/)
    expect(html).toContain('ascii-theme-preview')
    expect(html).toContain('+----------+')
    expect(html).toContain('[ SAVE ]')
    expect(render('default')).not.toMatch(/checked=""[^>]*value="ascii"|value="ascii"[^>]*checked=""/)
    for (const locale of [zhSettings, enSettings]) {
      expect(locale.themeSettings.options.ascii.title).toBeTruthy()
      expect(locale.themeSettings.options.ascii.description).toBeTruthy()
    }
    for (const locale of [zhPlugins, enPlugins]) {
      expect(locale.summary.ascii).toBeTruthy()
      expect(Object.keys(locale.settingsOptions.ascii.background)).toEqual(['field', 'rain', 'off'])
    }
  })
})
