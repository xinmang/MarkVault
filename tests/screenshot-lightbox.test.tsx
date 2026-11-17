/**
 * 网站截图灯箱的测试。
 *
 * 说明：仓库目前没有 jsdom / @testing-library（package.json 里没有相关依赖），
 * vitest 也没有配置 DOM 环境，因此无法做真实的点击与键盘事件测试。
 * 这里用 react-dom/server 做静态渲染断言（图片、元信息、只读时隐藏删除），
 * 并把 Esc 关闭等可判定逻辑放到 screenshot-utils 的纯函数里单独测试。
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { createInstance, type i18n as I18nInstance } from 'i18next'
import { initReactI18next } from 'react-i18next'
import zhBookmarks from '../src/i18n/locales/zh-CN/bookmarks.json'
import enBookmarks from '../src/i18n/locales/en/bookmarks.json'
import { ScreenshotLightboxDialog } from '../src/components/bookmarks/ScreenshotLightbox'
import {
  formatScreenshotFileSize,
  formatScreenshotMeta,
  formatScreenshotTime,
  isLightboxDismissKey,
  screenshotFileExtension,
  screenshotFileHost,
  screenshotFileName,
  shouldConvertToPng,
  supportsImageClipboard,
} from '../src/components/bookmarks/shared/screenshot-utils'
import type { BookmarkScreenshot } from '../src/lib/types'

// 组件里用 useMutation 删除截图，渲染时必须提供 QueryClient
vi.mock('@/hooks/useBookmarks', () => ({
  useDeleteScreenshot: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

const screenshot: BookmarkScreenshot = {
  id: 'shot-1',
  url: '/api/bookmark-screenshots/shot-1?u=user-1&b=bookmark-1&scope=owner&exp=1800000000&sig=signature',
  width: 1440,
  height: 2600,
  file_size: 1_500_000,
  mime_type: 'image/webp',
  created_at: '2026-01-02T03:04:05',
}

let i18n: I18nInstance

beforeAll(async () => {
  i18n = createInstance()
  await i18n.use(initReactI18next).init({
    lng: 'zh-CN',
    fallbackLng: 'zh-CN',
    ns: ['bookmarks'],
    defaultNS: 'bookmarks',
    resources: {
      'zh-CN': { bookmarks: zhBookmarks },
      en: { bookmarks: enBookmarks },
    },
    interpolation: { escapeValue: false },
  })
})

function renderDialog(readOnly: boolean): string {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={new QueryClient()}>
        <ScreenshotLightboxDialog
          bookmarkId="bookmark-1"
          bookmarkTitle="一篇值得收藏的长文"
          bookmarkUrl="https://example.com/post/1"
          screenshot={screenshot}
          readOnly={readOnly}
          onClose={() => undefined}
        />
      </QueryClientProvider>
    </I18nextProvider>
  )
}

describe('ScreenshotLightbox', () => {
  it('渲染截图、标题与宽高/大小/时间等元信息', () => {
    const html = renderDialog(false)

    // SSR 会把 URL 里的 & 转义成 &amp;
    expect(html).toContain(
      'src="/api/bookmark-screenshots/shot-1?u=user-1&amp;b=bookmark-1&amp;scope=owner'
    )
    expect(html).toContain('一篇值得收藏的长文')
    expect(html).toContain('1440×2600')
    expect(html).toContain('1.4 MB')
    expect(html).toContain('2026-01-02 03:04')
    // 下载、打开原网页、查看图片始终存在
    expect(html).toContain('下载')
    expect(html).toContain('打开原网页')
    expect(html).toContain('在新标签页查看图片')
  })

  it('是可访问的模态框', () => {
    const html = renderDialog(false)
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('aria-labelledby="')
    expect(html).toContain('关闭')
  })

  it('只读（公开分享页）时隐藏删除截图', () => {
    const readOnlyHtml = renderDialog(true)
    expect(readOnlyHtml).not.toContain('删除截图')

    const ownerHtml = renderDialog(false)
    expect(ownerHtml).toContain('删除截图')
  })

  it('Esc 被识别为关闭键，其余按键不会关闭', () => {
    expect(isLightboxDismissKey('Escape')).toBe(true)
    expect(isLightboxDismissKey('Esc')).toBe(false)
    expect(isLightboxDismissKey('Enter')).toBe(false)
  })
})

describe('截图元信息与文件名', () => {
  it('按 B/KB/MB 展示文件大小', () => {
    expect(formatScreenshotFileSize(0)).toBe('0 B')
    expect(formatScreenshotFileSize(-10)).toBe('0 B')
    expect(formatScreenshotFileSize(512)).toBe('512 B')
    expect(formatScreenshotFileSize(1024)).toBe('1.0 KB')
    expect(formatScreenshotFileSize(1_500_000)).toBe('1.4 MB')
  })

  it('时间格式化在非法输入时原样返回', () => {
    expect(formatScreenshotTime('2026-01-02T03:04:05')).toBe('2026-01-02 03:04')
    expect(formatScreenshotTime('not-a-date')).toBe('not-a-date')
    expect(formatScreenshotTime('')).toBe('')
  })

  it('元信息组合为 宽×高 · 大小 · 时间', () => {
    expect(formatScreenshotMeta(screenshot)).toBe('1440×2600 · 1.4 MB · 2026-01-02 03:04')
  })

  it('扩展名跟随 MIME 类型', () => {
    expect(screenshotFileExtension('image/webp')).toBe('webp')
    expect(screenshotFileExtension('image/jpeg')).toBe('jpg')
    expect(screenshotFileExtension('image/png')).toBe('png')
    expect(screenshotFileExtension('')).toBe('png')
  })

  it('域名去掉 www 并清理非法字符', () => {
    expect(screenshotFileHost('https://www.example.com/post/1')).toBe('example.com')
    expect(screenshotFileHost('https://linux.do/t/topic/123')).toBe('linux.do')
    expect(screenshotFileHost('not a url')).toBe('not-a-url')
    expect(screenshotFileHost('')).toBe('bookmark')
  })

  it('下载文件名使用 markvault-域名-时间戳.扩展名', () => {
    expect(
      screenshotFileName('https://www.example.com/post/1', {
        created_at: '2026-01-02T03:04:05',
        mime_type: 'image/webp',
      })
    ).toBe('markvault-example.com-20260102-0304.webp')

    // 拍摄时间缺失时回落到当前时间
    const now = new Date(2026, 4, 6, 7, 8, 9)
    expect(
      screenshotFileName('https://example.com', { created_at: 'bad', mime_type: 'image/png' }, now)
    ).toBe('markvault-example.com-20260506-0708.png')
  })
})

describe('剪贴板能力判断', () => {
  it('只有 ClipboardItem 与 clipboard.write 都存在时才支持复制图片', () => {
    expect(supportsImageClipboard(null)).toBe(false)
    expect(supportsImageClipboard({})).toBe(false)
    expect(supportsImageClipboard({ ClipboardItem: class {}, clipboard: null })).toBe(false)
    expect(supportsImageClipboard({ ClipboardItem: class {}, clipboard: {} })).toBe(false)
    expect(
      supportsImageClipboard({ ClipboardItem: class {}, clipboard: { write: () => undefined } })
    ).toBe(true)
  })

  it('只有 PNG 不需要转换', () => {
    expect(shouldConvertToPng('image/png')).toBe(false)
    expect(shouldConvertToPng('image/webp')).toBe(true)
    expect(shouldConvertToPng('image/jpeg')).toBe(true)
  })
})
