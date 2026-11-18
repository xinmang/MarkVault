#!/usr/bin/env node

/**
 * MarkVault Agent API 的零依赖客户端。
 * API Key 仅从环境变量读取；所有写操作都要求显式传入 --confirm。
 */

const HELP = `MarkVault Agent 客户端

环境变量：
  MARKVAULT_BASE_URL   MarkVault 地址，例如 http://localhost:8787
  MARKVAULT_API_KEY    具有对应细粒度权限的 API Key

命令：
  me
  search <关键词> [--limit 10]
  bookmarks [--keyword 关键词] [--tag-ids id1,id2]
            [--sort created|updated|pinned|popular]
            [--pinned true|false] [--page-size 20]
            [--page-cursor 游标]
  tab-groups [--page-size 30] [--page-cursor 游标]
  notes <bookmark|tab> <目标ID> [--page-size 30] [--page-cursor 游标]
  add-note <bookmark|tab> <目标ID> <内容> [--pinned true|false] --confirm
  update-note <备注ID> [--content 内容] [--pinned true|false] --confirm
  delete-note <备注ID> --confirm
  get-bookmark <书签ID>
  create-bookmark <标题> <网址> [--description 描述] [--tags 标签1,标签2]
                  [--tag-ids id1,id2] [--pinned true|false]
                  [--public true|false] --confirm
  update-bookmark <书签ID> [--title 标题] [--url 网址]
                  [--description 描述] [--tags 标签1,标签2]
                  [--tag-ids id1,id2] [--pinned true|false]
                  [--archived true|false] [--public true|false] --confirm
  delete-bookmark <书签ID> --confirm
  restore-bookmark <书签ID> --confirm
  tags
  get-tag <标签ID>
  create-tag <名称> [--color 颜色] --confirm
  update-tag <标签ID> [--name 名称] [--color 颜色] --confirm
  delete-tag <标签ID> --confirm

示例：
  node markvault-client.mjs me
  node markvault-client.mjs search "Docker" --limit 10
  node markvault-client.mjs bookmarks --sort updated --page-size 20
  node markvault-client.mjs bookmarks --tag-ids "id1,id2"
  node markvault-client.mjs create-tag "待读" --color "#7c3aed" --confirm
  node markvault-client.mjs create-bookmark "MarkVault" "https://example.com" --tags "工具,待读" --confirm`

class ClientError extends Error {
  constructor(message, payload) {
    super(message)
    this.name = 'ClientError'
    this.payload = payload
  }
}

function parseArguments(argv) {
  const positionals = []
  const options = new Map()

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (!value.startsWith('--')) {
      positionals.push(value)
      continue
    }

    const name = value.slice(2)
    if (name === 'confirm') {
      options.set(name, 'true')
      continue
    }

    const optionValue = argv[index + 1]
    if (!name || optionValue === undefined || optionValue.startsWith('--')) {
      throw new ClientError(`参数 --${name || '?'} 缺少值`)
    }
    options.set(name, optionValue)
    index += 1
  }

  return { positionals, options }
}

function assertAllowedOptions(options, allowed) {
  for (const name of options.keys()) {
    if (!allowed.includes(name)) {
      throw new ClientError(`不支持的参数：--${name}`)
    }
  }
}

function setOptionalParam(params, options, optionName, apiName = optionName) {
  const value = options.get(optionName)
  if (value !== undefined) params.set(apiName, value)
}

function requireConfirmation(options) {
  if (options.get('confirm') !== 'true') {
    throw new ClientError('写操作必须在用户明确确认后传入 --confirm')
  }
}

function splitCommaSeparated(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseBooleanOption(options, optionName) {
  const value = options.get(optionName)
  if (value === undefined) return undefined
  if (!['true', 'false'].includes(value)) {
    throw new ClientError(`--${optionName} 仅支持 true 或 false`)
  }
  return value === 'true'
}

function setBodyOption(body, options, optionName, apiName = optionName) {
  const value = options.get(optionName)
  if (value !== undefined) body[apiName] = value
}

function createRequest(command, argv) {
  const { positionals, options } = parseArguments(argv)
  const params = new URLSearchParams()

  if (command === 'me' || command === 'tags') {
    assertAllowedOptions(options, [])
    if (positionals.length > 0) throw new ClientError(`${command} 命令不接受位置参数`)
    return { method: 'GET', path: command }
  }

  if (command === 'tab-groups' || command === 'notes' || command === 'add-note') {
    const append = command === 'add-note'
    assertAllowedOptions(options, append ? ['pinned', 'confirm'] : ['page-size', 'page-cursor'])
    let path = 'tab-groups'
    if (command === 'tab-groups') {
      if (positionals.length) throw new ClientError('tab-groups 命令不接受位置参数')
    } else {
      const [kind, id, content] = positionals
      if (!['bookmark', 'tab'].includes(kind) || !id || positionals.length !== (append ? 3 : 2)) {
        throw new ClientError(`用法：${command} <bookmark|tab> <目标ID>${append ? ' <内容> --confirm' : ''}`)
      }
      path = `${kind === 'bookmark' ? 'bookmarks' : 'tab-groups/items'}/${encodeURIComponent(id)}/notes`
      if (append) {
        requireConfirmation(options)
        const pinned = parseBooleanOption(options, 'pinned')
        return { method: 'POST', path, body: { content, is_pinned: pinned } }
      }
    }
    setOptionalParam(params, options, 'page-size', 'page_size')
    setOptionalParam(params, options, 'page-cursor', 'page_cursor')
    return { method: 'GET', path, params }
  }

  if (command === 'update-note' || command === 'delete-note') {
    const remove = command === 'delete-note'
    assertAllowedOptions(options, remove ? ['confirm'] : ['content', 'pinned', 'confirm'])
    requireConfirmation(options)
    if (positionals.length !== 1 || !positionals[0]) throw new ClientError(`${command} 命令需要备注 ID`)
    const path = `notes/${encodeURIComponent(positionals[0])}`
    if (remove) return { method: 'DELETE', path }
    if (!options.has('content') && !options.has('pinned')) throw new ClientError('没有提供要修改的字段')
    return { method: 'PATCH', path, body: { content: options.get('content'), is_pinned: parseBooleanOption(options, 'pinned') } }
  }

  if (command === 'search') {
    assertAllowedOptions(options, ['limit'])
    const query = positionals.join(' ').trim()
    if (!query) throw new ClientError('search 命令需要搜索关键词')
    params.set('q', query)
    setOptionalParam(params, options, 'limit')
    return { method: 'GET', path: 'search', params }
  }

  if (command === 'bookmarks') {
    assertAllowedOptions(options, [
      'keyword',
      'tag-ids',
      'sort',
      'pinned',
      'page-size',
      'page-cursor',
    ])
    if (positionals.length > 0) throw new ClientError('bookmarks 命令不接受位置参数')

    const sort = options.get('sort')
    if (sort && !['created', 'updated', 'pinned', 'popular'].includes(sort)) {
      throw new ClientError('--sort 仅支持 created、updated、pinned 或 popular')
    }

    const pinned = options.get('pinned')
    if (pinned && !['true', 'false'].includes(pinned)) {
      throw new ClientError('--pinned 仅支持 true 或 false')
    }

    setOptionalParam(params, options, 'keyword')
    setOptionalParam(params, options, 'tag-ids', 'tags')
    setOptionalParam(params, options, 'sort')
    setOptionalParam(params, options, 'pinned')
    setOptionalParam(params, options, 'page-size', 'page_size')
    setOptionalParam(params, options, 'page-cursor', 'page_cursor')
    return { method: 'GET', path: 'bookmarks', params }
  }

  if (command === 'get-bookmark' || command === 'get-tag') {
    assertAllowedOptions(options, [])
    if (positionals.length !== 1) throw new ClientError(`${command} 命令需要一个 ID`)
    const resource = command === 'get-bookmark' ? 'bookmarks' : 'tags'
    return { method: 'GET', path: `${resource}/${encodeURIComponent(positionals[0])}` }
  }

  if (command === 'create-bookmark') {
    assertAllowedOptions(options, [
      'description',
      'tags',
      'tag-ids',
      'pinned',
      'public',
      'confirm',
    ])
    requireConfirmation(options)
    if (positionals.length !== 2) {
      throw new ClientError('create-bookmark 命令需要标题和网址')
    }
    const body = { title: positionals[0], url: positionals[1] }
    setBodyOption(body, options, 'description')
    if (options.has('tags')) body.tags = splitCommaSeparated(options.get('tags'))
    if (options.has('tag-ids')) body.tag_ids = splitCommaSeparated(options.get('tag-ids'))
    const pinned = parseBooleanOption(options, 'pinned')
    const isPublic = parseBooleanOption(options, 'public')
    if (pinned !== undefined) body.is_pinned = pinned
    if (isPublic !== undefined) body.is_public = isPublic
    return { method: 'POST', path: 'bookmarks', body }
  }

  if (command === 'update-bookmark') {
    assertAllowedOptions(options, [
      'title',
      'url',
      'description',
      'tags',
      'tag-ids',
      'pinned',
      'archived',
      'public',
      'confirm',
    ])
    requireConfirmation(options)
    if (positionals.length !== 1) throw new ClientError('update-bookmark 命令需要书签 ID')
    const body = {}
    setBodyOption(body, options, 'title')
    setBodyOption(body, options, 'url')
    setBodyOption(body, options, 'description')
    if (options.has('tags')) body.tags = splitCommaSeparated(options.get('tags'))
    if (options.has('tag-ids')) body.tag_ids = splitCommaSeparated(options.get('tag-ids'))
    for (const [optionName, apiName] of [
      ['pinned', 'is_pinned'],
      ['archived', 'is_archived'],
      ['public', 'is_public'],
    ]) {
      const value = parseBooleanOption(options, optionName)
      if (value !== undefined) body[apiName] = value
    }
    if (Object.keys(body).length === 0) throw new ClientError('没有提供要修改的字段')
    return {
      method: 'PATCH',
      path: `bookmarks/${encodeURIComponent(positionals[0])}`,
      body,
    }
  }

  if (command === 'delete-bookmark' || command === 'restore-bookmark') {
    assertAllowedOptions(options, ['confirm'])
    requireConfirmation(options)
    if (positionals.length !== 1) throw new ClientError(`${command} 命令需要书签 ID`)
    const suffix = command === 'restore-bookmark' ? '/restore' : ''
    return {
      method: command === 'restore-bookmark' ? 'PATCH' : 'DELETE',
      path: `bookmarks/${encodeURIComponent(positionals[0])}${suffix}`,
      ...(command === 'restore-bookmark' ? { body: {} } : {}),
    }
  }

  if (command === 'create-tag') {
    assertAllowedOptions(options, ['color', 'confirm'])
    requireConfirmation(options)
    if (positionals.length !== 1) throw new ClientError('create-tag 命令需要标签名称')
    const body = { name: positionals[0] }
    setBodyOption(body, options, 'color')
    return { method: 'POST', path: 'tags', body }
  }

  if (command === 'update-tag') {
    assertAllowedOptions(options, ['name', 'color', 'confirm'])
    requireConfirmation(options)
    if (positionals.length !== 1) throw new ClientError('update-tag 命令需要标签 ID')
    const body = {}
    setBodyOption(body, options, 'name')
    setBodyOption(body, options, 'color')
    if (Object.keys(body).length === 0) throw new ClientError('没有提供要修改的字段')
    return { method: 'PATCH', path: `tags/${encodeURIComponent(positionals[0])}`, body }
  }

  if (command === 'delete-tag') {
    assertAllowedOptions(options, ['confirm'])
    requireConfirmation(options)
    if (positionals.length !== 1) throw new ClientError('delete-tag 命令需要标签 ID')
    return { method: 'DELETE', path: `tags/${encodeURIComponent(positionals[0])}` }
  }

  throw new ClientError(`未知命令：${command || '(空)'}`)
}

async function requestJson(baseUrl, apiKey, request) {
  const url = new URL(`/api/v1/agent/${request.path}`, `${baseUrl}/`)
  if (request.params) url.search = request.params.toString()

  const response = await fetch(url, {
    method: request.method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
  })

  const rawBody = await response.text()
  let payload = null
  if (rawBody) {
    try {
      payload = JSON.parse(rawBody)
    } catch {
      payload = { raw: rawBody }
    }
  }

  if (!response.ok) {
    const retryAfter = response.headers.get('Retry-After')
    const suffix = retryAfter ? `，请在 ${retryAfter} 秒后重试` : ''
    throw new ClientError(`请求失败（HTTP ${response.status}）${suffix}`, payload)
  }

  return payload
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    console.log(HELP)
    return
  }

  const baseUrl = process.env.MARKVAULT_BASE_URL?.trim().replace(/\/+$/, '')
  const apiKey = process.env.MARKVAULT_API_KEY?.trim()
  if (!baseUrl) throw new ClientError('缺少环境变量 MARKVAULT_BASE_URL')
  if (!apiKey) throw new ClientError('缺少环境变量 MARKVAULT_API_KEY')

  let parsedBaseUrl
  try {
    parsedBaseUrl = new URL(baseUrl).toString().replace(/\/+$/, '')
  } catch {
    throw new ClientError('MARKVAULT_BASE_URL 不是有效的网址')
  }

  const request = createRequest(argv[0], argv.slice(1))
  const payload = await requestJson(parsedBaseUrl, apiKey, request)
  console.log(JSON.stringify(payload, null, 2))
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`MarkVault：${message}`)
  if (error instanceof ClientError && error.payload) {
    console.error(JSON.stringify(error.payload, null, 2))
  }
  process.exitCode = 1
})
