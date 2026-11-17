import {
  Activity,
  AlignLeft,
  Blocks,
  Bot,
  Cable,
  ChartColumn,
  Chrome,
  Cloud,
  Code,
  Columns3,
  Cpu,
  Database,
  Droplets,
  EyeOff,
  Fingerprint,
  Flame,
  Focus,
  GalleryVerticalEnd,
  Gauge,
  Globe,
  History,
  ImageUp,
  Images,
  Infinity as InfinityIcon,
  Key,
  LayoutGrid,
  LayoutTemplate,
  ListCollapse,
  Loader,
  MousePointer,
  Palette,
  PanelTop,
  Plug,
  Puzzle,
  Server,
  Settings,
  Shield,
  Sparkles,
  SunMoon,
  SwatchBook,
  Terminal,
  Waves,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import type { PluginCategory, PluginState } from '@shared/plugin-types'
import { getPluginCategory } from './navigation'

/**
 * 清单 icon 字段到图标组件的映射。逐个具名引入以保留 tree-shaking，
 * 需覆盖 plugins/builtins.go 里登记的全部图标名；后半部分是给第三方插件预留的常用名称。
 */
const ICONS: Record<string, LucideIcon> = {
  'panel-top': PanelTop,
  sparkles: Sparkles,
  palette: Palette,
  terminal: Terminal,
  droplets: Droplets,
  infinity: InfinityIcon,
  'swatch-book': SwatchBook,
  loader: Loader,
  activity: Activity,
  'sun-moon': SunMoon,
  waves: Waves,
  'mouse-pointer': MousePointer,
  flame: Flame,
  'gallery-vertical-end': GalleryVerticalEnd,
  'eye-off': EyeOff,
  bot: Bot,
  cpu: Cpu,
  wrench: Wrench,
  key: Key,
  server: Server,
  cable: Cable,
  'image-up': ImageUp,
  chrome: Chrome,
  fingerprint: Fingerprint,
  // lucide 新版把 bar-chart 系列改名为 chart-column，这里统一指向柱状图
  'bar-chart': ChartColumn,
  gauge: Gauge,
  images: Images,
  history: History,
  globe: Globe,
  focus: Focus,
  cloud: Cloud,
  'align-left': AlignLeft,
  columns: Columns3,
  'list-collapse': ListCollapse,
  'layout-template': LayoutTemplate,
  'chart-column': ChartColumn,
  'layout-grid': LayoutGrid,
  puzzle: Puzzle,
  plug: Plug,
  blocks: Blocks,
  code: Code,
  database: Database,
  settings: Settings,
  shield: Shield,
}

const CATEGORY_ICONS: Record<PluginCategory, LucideIcon> = {
  appearance: Palette,
  effects: Sparkles,
  intelligence: Bot,
  connections: Cable,
  insights: ChartColumn,
  layouts: LayoutGrid,
  other: Puzzle,
}

/** 已登记的图标名，测试用它核对 plugins/builtins.go 里的图标都有映射。 */
export const PLUGIN_ICON_NAMES = Object.keys(ICONS)

const own = (record: object, key: string) => Object.prototype.hasOwnProperty.call(record, key)

/** 未声明或未知的图标名按分类给默认图标，分类也未知时用拼图。 */
// eslint-disable-next-line react-refresh/only-export-components
export function resolvePluginIcon(name?: string, category?: PluginCategory): LucideIcon {
  const declared = name && own(ICONS, name) ? ICONS[name] : undefined
  if (declared) return declared
  return category && own(CATEGORY_ICONS, category) ? CATEGORY_ICONS[category] : Puzzle
}

export function PluginIcon({
  plugin,
  className,
  size = 18,
}: {
  plugin: PluginState
  className?: string
  size?: number
}) {
  const Icon = resolvePluginIcon(plugin.manifest.icon, getPluginCategory(plugin))
  return <Icon className={className} size={size} aria-hidden="true" />
}
