export const EXTENSION_REPOSITORY_URL = 'https://github.com/xinmang/markvault-extension'
export const EXTENSION_RELEASES_URL = `${EXTENSION_REPOSITORY_URL}/releases`
export const EXTENSION_DOWNLOAD_URL = `${EXTENSION_RELEASES_URL}/latest/download/markvault-extension-chrome.zip`

export const CHROMIUM_BROWSERS = ['Chrome', 'Edge', 'Brave', 'Opera', '360', 'QQ', 'Sogou']

/** 由 GitHub Release 提供安装包，下载入口共用同一地址。 */
export function downloadExtension() {
  const link = document.createElement('a')
  link.href = EXTENSION_DOWNLOAD_URL
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  document.body.appendChild(link)
  link.click()
  link.remove()
}
