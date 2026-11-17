// 浏览器集成测试必须指向一次性测试实例和数据库，禁止对生产实例运行。
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
const modulePath = process.env.MARKVAULT_PLAYWRIGHT_MODULE
const databasePath = process.env.MARKVAULT_E2E_DATABASE
const base = process.env.MARKVAULT_E2E_URL
if (!modulePath || !databasePath || !base || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error('请配置本地一次性 E2E 实例、数据库和 Playwright 模块路径')
const { chromium } = await import(pathToFileURL(resolve(modulePath)).href)
const username = 'plugin' + Date.now()
const password = randomUUID() + 'aB1!'
const api = async (path, body, token, method = 'POST') => {
  const response = await fetch(base + '/api/v1' + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const result = await response.json()
  if (!response.ok) throw new Error(path + ': ' + JSON.stringify(result))
  return result.data
}
await api('/auth/register', { username, password })
const login = await api('/auth/login', { username, password })
const db = new DatabaseSync(databasePath)
db.prepare("UPDATE users SET role='admin' WHERE id=?").run(login.user.id)
db.close()
const browser = await chromium.launch({ ...(process.env.MARKVAULT_BROWSER_CHANNEL ? { channel: process.env.MARKVAULT_BROWSER_CHANNEL } : {}), headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' })
const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))
await context.addInitScript(({ login }) => {
  if (window !== window.top) return
  localStorage.setItem('auth-storage', JSON.stringify({ state: { user: login.user, accessToken: login.access_token, refreshToken: login.refresh_token, isAuthenticated: true, sessionVersion: 1 }, version: 0 }))
  localStorage.setItem('markvault-language', 'zh-CN')
}, { login })
try {
  await page.goto(base + '/plugins')
  await page.getByRole('heading', { name: '自定义插件', exact: true }).waitFor()
  // 清单名称写作「中文 / English」，界面按语言只显示其中一段；iframe 的 title 仍是清单原名
  const card = page.locator('article').filter({ has: page.getByRole('heading', { name: '插件便笺', exact: true }) })
  // 目录条目和管理员身份都是异步加载的：页面标题出现时卡片上的按钮可能还没渲染，
  // 先等按钮出现再判断是否需要安装，否则会跳过安装并一直等不到「已安装」
  const install = card.getByRole('button', { name: '安装', exact: true })
  const installed = card.getByRole('button', { name: '已安装', exact: true })
  await install.or(installed).waitFor()
  if (await install.isVisible()) await install.click()
  await installed.waitFor()
  await page.goto(base + '/plugins/examples.notes')
  await page.getByRole('heading', { name: '插件便笺', exact: true }).waitFor()
  const checkboxes = page.getByRole('checkbox')
  for (let i = 0; i < await checkboxes.count(); i++) await checkboxes.nth(i).check()
  await page.getByRole('button', { name: '授权并启用', exact: true }).click()
  const frame = page.frameLocator('iframe[title="插件便笺 / Plugin notes"]')
  await frame.getByRole('textbox').fill('沙盒隔离验证')
  await frame.getByRole('button', { name: '保存 / Save' }).click()
  await frame.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  const child = page.frames().find(f => f !== page.mainFrame())
  if (!await child.evaluate(() => { try { void parent.document.body; return false } catch { return true } })) throw new Error('iframe 获得父页 DOM')
  // 父页伪造消息即使复制通道，也不能冒充已绑定的 iframe。
  const requests = []
  page.on('request', request => { if (request.url().endsWith('/rpc')) requests.push(request) })
  // 伪造消息之后再发一条标记消息：消息按顺序派发，标记到达时宿主已处理过伪造消息，
  // 再让出一轮事件循环，宿主若接受了伪造消息，此时请求已经发出
  await page.evaluate(() => new Promise(done => {
    const source = document.querySelector('iframe').srcdoc
    const channel = source.match(/const channel="([^"]+)"/)[1]
    const marker = 'forged-delivered'
    const listener = event => { if (event.data !== marker) return; removeEventListener('message', listener); setTimeout(done, 0) }
    addEventListener('message', listener)
    window.postMessage({ channel, type: 'rpc', id: 999, method: 'storage.set', args: { key: 'notes', value: 'forged' } }, '*')
    window.postMessage(marker, '*')
  }))
  const forged = () => requests.some(request => (request.postData() ?? '').includes('forged'))
  if (forged()) throw new Error('父页伪造的消息触发了插件 RPC')
  await page.reload()
  // 便笺页先渲染空文本框，再异步从插件存储读回内容：文本框出现时值可能还是空的，
  // 需要等内容回填，不能在文本框出现后立刻读取
  const textbox = frame.getByRole('textbox')
  await textbox.waitFor()
  const deadline = Date.now() + 15000
  let restored = await textbox.inputValue()
  while (restored !== '沙盒隔离验证' && Date.now() < deadline) {
    await page.waitForTimeout(100)
    restored = await textbox.inputValue()
  }
  if (restored !== '沙盒隔离验证') throw new Error('刷新后便笺内容未恢复，当前值：' + JSON.stringify(restored))
  if (forged()) throw new Error('父页伪造的消息触发了插件 RPC')
  await page.getByRole('button', { name: '停用', exact: true }).click()
  await page.locator('iframe').waitFor({ state: 'detached' })
  await page.goto(base + '/plugins?safe=1')
  await page.getByText('本页面已跳过可选插件，可在此停用故障插件。').waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error('移动端横向溢出')
  if (errors.length) throw new Error(errors.join('\n'))
  console.log('通过：市场安装、授权、iframe SDK、父页 DOM 隔离、消息伪造、刷新恢复、停用、安全模式和移动端布局')
} catch (error) {
  // 失败时附带页面上的提示和目录卡片的状态，便于从 CI 日志判断原因
  const state = await page.evaluate(() => ({ path: location.pathname, alerts: [...document.querySelectorAll('[role="alert"]')].map(element => element.textContent), cards: [...document.querySelectorAll('article')].map(element => element.textContent.slice(0, 80)) })).catch(() => null)
  console.error('失败时的页面状态：' + JSON.stringify(state))
  throw error
} finally {
  await browser.close()
}
