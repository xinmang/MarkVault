import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyToClipboard } from '../src/lib/clipboard'

afterEach(() => vi.unstubAllGlobals())

const key = 'mv_仅用于复制测试的完整密钥'

function mockDocument(copy: () => boolean = () => true) {
  class Element {
    focus = vi.fn()
  }
  const previousFocus = new Element()
  const textArea = {
    value: '',
    style: {},
    setAttribute: vi.fn(),
    focus: vi.fn(),
    select: vi.fn(),
    setSelectionRange: vi.fn(),
    remove: vi.fn(),
  }
  const document = {
    activeElement: previousFocus,
    createElement: vi.fn(() => textArea),
    body: { appendChild: vi.fn() },
    execCommand: vi.fn(copy),
  }
  vi.stubGlobal('HTMLElement', Element)
  vi.stubGlobal('document', document)
  return { document, textArea, previousFocus }
}

describe('API Key 复制兼容性', () => {
  it('等待剪贴板实际写入成功后才完成', async () => {
    let finishCopy!: () => void
    const writeText = vi.fn(() => new Promise<void>((resolve) => { finishCopy = resolve }))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const { document } = mockDocument()
    const completed = vi.fn()
    const pending = copyToClipboard(key).then(completed)

    await Promise.resolve()
    expect(completed).not.toHaveBeenCalled()
    expect(writeText).toHaveBeenCalledWith(key)
    finishCopy()
    await pending

    expect(completed).toHaveBeenCalledOnce()
    expect(document.execCommand).not.toHaveBeenCalled()
  })

  it('HTTP 环境没有剪贴板接口时复制完整密钥，并移除临时文本', async () => {
    vi.stubGlobal('navigator', {})
    const { document, textArea, previousFocus } = mockDocument()

    await expect(copyToClipboard(key)).resolves.toBeUndefined()

    expect(textArea.value).toBe(key)
    expect(textArea.select).toHaveBeenCalledOnce()
    expect(textArea.setSelectionRange).toHaveBeenCalledWith(0, key.length)
    expect(document.execCommand).toHaveBeenCalledWith('copy')
    expect(textArea.remove).toHaveBeenCalledOnce()
    expect(previousFocus.focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('剪贴板写入被拒绝时尝试兼容复制', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('剪贴板权限被拒绝'))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const { document, textArea } = mockDocument()

    await expect(copyToClipboard(key)).resolves.toBeUndefined()

    expect(writeText).toHaveBeenCalledWith(key)
    expect(textArea.value).toBe(key)
    expect(document.execCommand).toHaveBeenCalledWith('copy')
    expect(textArea.remove).toHaveBeenCalledOnce()
  })

  it.each([
    ['返回失败', () => false],
    ['抛出异常', () => { throw new Error('浏览器禁止复制') }],
  ] as const)('兼容复制%s时报告失败，并清理密钥和恢复焦点', async (_scenario, copy) => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('剪贴板权限被拒绝')) },
    })
    const { textArea, previousFocus } = mockDocument(copy)

    await expect(copyToClipboard(key)).rejects.toThrow()

    expect(textArea.remove).toHaveBeenCalledOnce()
    expect(previousFocus.focus).toHaveBeenCalledWith({ preventScroll: true })
  })
})
