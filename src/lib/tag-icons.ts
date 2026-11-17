import {
  siGithub,
  siGitlab,
  siDocker,
  siKubernetes,
  siPython,
  siJavascript,
  siTypescript,
  siReact,
  siVuedotjs,
  siGo,
  siRust,
  siNodedotjs,
  siLinux,
  siUbuntu,
  siDebian,
  siArchlinux,
  siNginx,
  siRedis,
  siMysql,
  siPostgresql,
  siSqlite,
  siMongodb,
  siCloudflare,
  siGoogle,
  siYoutube,
  siBilibili,
  siTelegram,
  siDiscord,
  siReddit,
  siX,
  siNotion,
  siObsidian,
  siFigma,
  siVercel,
  siNetlify,
  siStackoverflow,
  siNpm,
  siPnpm,
  siHomeassistant,
  siSynology,
  siNextdotjs,
  siSvelte,
  siZhihu,
} from 'simple-icons'
import {
  Tag,
  Code2,
  Terminal,
  Globe,
  BookOpen,
  Server,
  Database,
  Cloud,
  Folder,
  Star,
  Heart,
  Music,
  Film,
  GraduationCap,
  Wrench,
  Gamepad2,
  Lightbulb,
  Palette,
  Shield,
  Rss,
} from 'lucide-react'

const brands = [
  siGithub,
  siGitlab,
  siDocker,
  siKubernetes,
  siPython,
  siJavascript,
  siTypescript,
  siReact,
  siVuedotjs,
  siGo,
  siRust,
  siNodedotjs,
  siLinux,
  siUbuntu,
  siDebian,
  siArchlinux,
  siNginx,
  siRedis,
  siMysql,
  siPostgresql,
  siSqlite,
  siMongodb,
  siCloudflare,
  siGoogle,
  siYoutube,
  siBilibili,
  siTelegram,
  siDiscord,
  siReddit,
  siX,
  siNotion,
  siObsidian,
  siFigma,
  siVercel,
  siNetlify,
  siStackoverflow,
  siNpm,
  siPnpm,
  siHomeassistant,
  siSynology,
  siNextdotjs,
  siSvelte,
  siZhihu,
]

export const BRAND_TAG_ICONS = brands.map(({ slug, title, path }) => ({ id: slug, title, path }))
export const GENERIC_TAG_ICONS = [
  { id: 'tag', component: Tag },
  { id: 'code', component: Code2 },
  { id: 'terminal', component: Terminal },
  { id: 'globe', component: Globe },
  { id: 'book', component: BookOpen },
  { id: 'server', component: Server },
  { id: 'database', component: Database },
  { id: 'cloud', component: Cloud },
  { id: 'folder', component: Folder },
  { id: 'star', component: Star },
  { id: 'heart', component: Heart },
  { id: 'music', component: Music },
  { id: 'film', component: Film },
  { id: 'study', component: GraduationCap },
  { id: 'tools', component: Wrench },
  { id: 'game', component: Gamepad2 },
  { id: 'idea', component: Lightbulb },
  { id: 'design', component: Palette },
  { id: 'shield', component: Shield },
  { id: 'rss', component: Rss },
]

function normalizeName(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s._-]+/g, '')
}
const brandById = new Map(BRAND_TAG_ICONS.map((icon) => [icon.id, icon]))
const brandByName = new Map(
  BRAND_TAG_ICONS.flatMap((icon) => [
    [normalizeName(icon.id), icon] as const,
    [normalizeName(icon.title), icon] as const,
  ])
)
for (const [alias, id] of Object.entries({
  k8s: 'kubernetes',
  js: 'javascript',
  ts: 'typescript',
  vue: 'vuedotjs',
  node: 'nodedotjs',
  nodejs: 'nodedotjs',
  golang: 'go',
  nextjs: 'nextdotjs',
  postgres: 'postgresql',
  哔哩哔哩: 'bilibili',
  b站: 'bilibili',
  知乎: 'zhihu',
  群晖: 'synology',
  twitter: 'x',
  油管: 'youtube',
})) {
  const icon = brandById.get(id)
  if (icon) brandByName.set(normalizeName(alias), icon)
}
const genericById = new Map(GENERIC_TAG_ICONS.map((icon) => [icon.id, icon]))

export const MAX_TAG_ICON_BYTES = 64 * 1024
const imageDataPattern = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/

export function isValidTagIcon(value: unknown): value is string | null {
  if (value === null || value === 'none') return true
  if (typeof value !== 'string' || !value) return false
  if (value.startsWith('brand:')) return brandById.has(value.slice(6))
  if (value.startsWith('icon:')) return genericById.has(value.slice(5))
  if (value.startsWith('data:')) {
    if (!imageDataPattern.test(value)) return false
    const base64 = value.slice(value.indexOf(',') + 1)
    return (
      base64.length % 4 === 0 &&
      (base64.length / 4) * 3 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0) <=
        MAX_TAG_ICON_BYTES
    )
  }
  if (value.length > 2048) return false
  try {
    const url = new URL(value)
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      !!url.hostname &&
      !url.username &&
      !url.password
    )
  } catch {
    return false
  }
}

export function resolveTagIcon(name: string, value?: string | null) {
  if (value === 'none') return null
  if (!value) {
    const brand = brandByName.get(normalizeName(name))
    return brand ? { kind: 'brand' as const, ...brand } : null
  }
  if (!isValidTagIcon(value)) return null
  if (value.startsWith('brand:'))
    return { kind: 'brand' as const, ...brandById.get(value.slice(6))! }
  if (value.startsWith('icon:'))
    return { kind: 'icon' as const, ...genericById.get(value.slice(5))! }
  return { kind: 'image' as const, src: value }
}
