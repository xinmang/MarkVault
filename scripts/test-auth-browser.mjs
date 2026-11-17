// 仅启动隔离数据目录测试认证流程，不连接或修改已有预览实例。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

const executable = process.env.MARKVAULT_E2E_EXECUTABLE
const playwright = process.env.MARKVAULT_PLAYWRIGHT_MODULE
const chrome = process.env.MARKVAULT_BROWSER_EXECUTABLE
if (!executable || !playwright || !chrome)
  throw new Error('请提供测试服务程序、Playwright 模块和 Chromium 路径')
const root = resolve('.data')
mkdirSync(root, { recursive: true })
const dataDir = mkdtempSync(resolve(root, 'auth-e2e-'))
const base = 'http://localhost:18789'
const server = spawn(resolve(executable), [], {
  windowsHide: true,
  env: {
    ...process.env,
    MARKVAULT_ADDR: '127.0.0.1:18789',
    MARKVAULT_DATA_DIR: dataDir,
    MARKVAULT_WEB_DIR: resolve('dist'),
    ALLOW_REGISTRATION: 'true',
    JWT_SECRET: randomUUID() + randomUUID(),
    ENCRYPTION_KEY: randomUUID() + randomUUID(),
  },
  stdio: ['ignore', 'ignore', 'pipe'],
})
let logs = ''
server.stderr.on('data', (chunk) => {
  logs += chunk.toString()
})
let browser
try {
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error(logs)
    try {
      if ((await fetch(base + '/api/v1/health')).ok) break
    } catch {}
    if (i === 59) throw new Error('测试实例未启动')
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  const { chromium } = await import(pathToFileURL(resolve(playwright)).href)
  browser = await chromium.launch({ executablePath: chrome, headless: true })
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: 'zh-CN',
  })
  const page = await context.newPage()
  const goto = async (path) => {
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/auth/options')),
      page.goto(base + path),
    ])
  }
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const cdp = await context.newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
  const password = randomUUID() + 'aB1!'
  const api = async (path, body, token, method = 'POST', status = 200) => {
    const response = await fetch(base + '/api/v1' + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const text = await response.text()
    assert.equal(response.status, status, path + ': ' + text)
    return text ? JSON.parse(text).data : null
  }
  await page.goto(base + '/login')
  await page.getByRole('link', { name: '立即注册 →' }).waitFor()
  const owner = await api('/auth/register', { username: 'owner', password }, null, 'POST', 201)
  assert.equal(owner.user.role, 'admin')
  await goto('/login')
  await page.getByRole('button', { name: '立即登录', exact: true }).waitFor()
  assert.equal(await page.getByRole('link', { name: '立即注册 →' }).count(), 0)
  await page.goto(base + '/register')
  await page.getByRole('heading', { name: '本站已关闭用户注册' }).waitFor()
  await page.goto(base + '/login')
  await page.locator('#username').fill('owner')
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: '立即登录', exact: true }).click()
  await page.waitForURL(base + '/')
  await page.goto(base + '/settings/general?section=basic')
  await page.getByRole('checkbox', { name: '允许新用户注册' }).waitFor()
  assert.equal(await page.getByRole('checkbox', { name: '允许新用户注册' }).isChecked(), false)
  const passwordButton = page.getByRole('button', { name: '修改密码', exact: true })
  const alignment = await passwordButton.evaluate((el) => {
    const row = el.closest('.settings-action-row')
    return row.getBoundingClientRect().right - el.getBoundingClientRect().right
  })
  assert.ok(alignment < 2, '修改密码按钮未右对齐')
  const userIDVisible = await page.getByText(owner.user.id, { exact: true }).count()
  assert.equal(userIDVisible, 0)
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith('/settings/auth') && response.request().method() === 'PUT'
    ),
    page.getByRole('checkbox', { name: '允许新用户注册' }).locator('..').click(),
  ])
  const ownerToken = await page.evaluate(
    () => JSON.parse(localStorage.getItem('auth-storage')).state.accessToken
  )
  await api('/auth/register', { username: 'member', password }, null, 'POST', 201)
  await page.getByRole('checkbox', { name: '启用 通行密钥 / Passkey' }).locator('..').click()
  await page.getByRole('button', { name: '添加通行密钥', exact: true }).waitFor()
  await page.getByLabel('密钥名称', { exact: true }).fill('浏览器测试密钥')
  await page.getByLabel('当前密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '添加通行密钥', exact: true }).click()
  await page.getByText('通行密钥已添加', { exact: true }).waitFor({ timeout: 15000 })
  await page.getByText('浏览器测试密钥', { exact: true }).waitFor()
  // 单独模拟协议响应，验证签名篡改、重放与删除后的凭据不能获得会话。
  const assertion = async () =>
    page.evaluate(async () => {
      const start = await fetch('/api/v1/auth/passkey/login/begin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const begin = (await start.json()).data
      const decode = (value) =>
        Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
          .buffer
      const encode = (value) =>
        btoa(String.fromCharCode(...new Uint8Array(value)))
          .split('+')
          .join('-')
          .split('/')
          .join('_')
          .replace(/=+$/, '')
      const key = await navigator.credentials.get({
        publicKey: {
          ...begin.options.publicKey,
          challenge: decode(begin.options.publicKey.challenge),
        },
      })
      return {
        session_id: begin.session_id,
        credential: {
          id: key.id,
          rawId: encode(key.rawId),
          type: key.type,
          clientExtensionResults: key.getClientExtensionResults(),
          response: {
            clientDataJSON: encode(key.response.clientDataJSON),
            authenticatorData: encode(key.response.authenticatorData),
            signature: encode(key.response.signature),
            userHandle: encode(key.response.userHandle),
          },
        },
      }
    })
  const finish = (body) =>
    page.evaluate(
      async (body) =>
        (
          await fetch('/api/v1/auth/passkey/login/finish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
        ).status,
      body
    )
  const forged = await assertion()
  forged.credential.response.signature = 'AAAA'
  assert.equal(await finish(forged), 401, '伪造签名被接受')
  const replay = await assertion()
  assert.equal(await finish(replay), 200)
  assert.equal(await finish(replay), 400, '登录挑战允许重放')
  // 验证用户要求的默认紧凑设置界面，同时保留各主题中的操作行右对齐。
  for (const id of ['classic', 'vibehub', 'uiux-pro'])
    await api(
      '/plugins/markvault.' + id,
      { enabled: false, config: {}, grants: [] },
      ownerToken,
      'PUT'
    )
  await page.goto(base + '/settings/general?section=basic&plugin=markvault.passkey')
  await page.locator('[data-management-theme="default"]').waitFor()
  await page.getByText('浏览器测试密钥', { exact: true }).waitFor()
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) animation.finish()
    window.scrollTo(0, 0)
  })
  await page.screenshot({ path: resolve(dataDir, 'settings-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
    false,
    '手机布局溢出'
  )
  await page.screenshot({ path: resolve(dataDir, 'settings-mobile.png'), fullPage: true })
  await page.setViewportSize({ width: 1280, height: 900 })
  const signOut = async () => {
    await page.evaluate(() => localStorage.removeItem('auth-storage'))
    await goto('/login')
  }
  await signOut()
  await page.getByRole('button', { name: '使用通行密钥登录', exact: true }).click()
  await page.waitForURL(base + '/')
  assert.equal(
    await page.evaluate(() => JSON.parse(localStorage.getItem('auth-storage')).state.user.id),
    owner.user.id
  )
  await page.goto(base + '/settings/general?section=basic&plugin=markvault.passkey')
  await page.getByRole('checkbox', { name: '启用 通行密钥 / Passkey' }).locator('..').click()
  await api(
    '/plugins/markvault.passkey',
    { enabled: false, config: {}, grants: [] },
    ownerToken,
    'PUT'
  )
  await signOut()
  assert.equal(await page.getByRole('button', { name: '使用通行密钥登录', exact: true }).count(), 0)
  await api(
    '/plugins/markvault.passkey',
    { enabled: true, config: {}, grants: [] },
    ownerToken,
    'PUT'
  )
  await page.reload()
  await page.getByRole('button', { name: '使用通行密钥登录', exact: true }).click()
  await page.waitForURL(base + '/')
  await page.goto(base + '/settings/general?section=basic&plugin=markvault.passkey')
  await page.getByLabel('当前密码', { exact: true }).fill(password)
  const deletedAssertion = await assertion()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '删除 浏览器测试密钥', exact: true }).click()
  await page.getByText('通行密钥已删除', { exact: true }).waitFor()
  assert.equal(await finish(deletedAssertion), 401, '已删除密钥仍获得登录会话')
  // 修改密码操作既要靠右，也要真正调用正确接口并清理失效会话。
  const newPassword = randomUUID() + 'aB1!'
  await page.getByRole('button', { name: '修改密码', exact: true }).click()
  await page.getByPlaceholder('请输入当前密码', { exact: true }).fill(password)
  await page.getByPlaceholder('请输入新密码（至少 8 个字符）', { exact: true }).fill(newPassword)
  await page.getByPlaceholder('请再次输入新密码', { exact: true }).fill(newPassword)
  await page.getByRole('button', { name: '确认修改', exact: true }).click()
  await page.waitForURL(base + '/login')
  await api('/auth/login', { username: 'owner', password: newPassword }, null)
  await signOut()
  assert.equal(await page.getByRole('button', { name: '使用通行密钥登录', exact: true }).count(), 0)
  assert.deepEqual(errors, [])
  console.log(
    '通过：首用户关闭注册、隐藏入口、管理员重开、Passkey 真实绑定和登录、停用/恢复、删除、桌面按钮对齐和手机布局。'
  )
  console.log('截图目录：' + dataDir)
} finally {
  await browser?.close()
  server.kill()
}
