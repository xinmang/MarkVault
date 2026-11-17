/**
 * 复制文本；剪贴板接口不可用或被拒绝时，兼容通过 HTTP 访问的自托管实例。
 */
export async function copyToClipboard(value: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return
    }
  } catch {
    // 浏览器可能拒绝异步剪贴板权限，继续尝试选中文本复制。
  }

  const previousFocus = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null
  const textArea = document.createElement('textarea')
  textArea.value = value
  textArea.setAttribute('readonly', '')
  textArea.style.position = 'fixed'
  textArea.style.opacity = '0'
  textArea.style.pointerEvents = 'none'
  document.body.appendChild(textArea)

  try {
    textArea.focus({ preventScroll: true })
    textArea.select()
    textArea.setSelectionRange(0, value.length)
    if (!document.execCommand('copy')) {
      throw new Error('复制失败')
    }
  } finally {
    textArea.remove()
    previousFocus?.focus({ preventScroll: true })
  }
}
