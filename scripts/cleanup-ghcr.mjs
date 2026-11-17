#!/usr/bin/env node
// MarkVault 的 GHCR 无标签镜像清理工具。
//
// 安全约束（改代码前务必读完）：
// 1. 只处理 GITHUB_REPOSITORY 对应的那一个容器包，且包必须明确关联到本仓库。
// 2. 只删除「无任何 tag、未被保留引用图保护、created_at 与 updated_at 都早于阈值」的版本。
// 3. 默认只预览。真正删除必须提供与本次重算一致的 plan_sha256。
// 4. 元数据缺失、分页不完整、引用清单读不到、结构未知一律 fail closed。
//
// 只支持 github.com / ghcr.io。仅使用 Node 内置模块，令牌不写入文件，也不进日志。
//
// 环境变量：
//   GITHUB_REPOSITORY      owner/repo
//   GITHUB_TOKEN           GitHub 令牌（工作流用 github.token）
//   DRY_RUN                true/false，默认 true
//   EXPECTED_PLAN_SHA256   dry_run=false 时必填
//   MIN_AGE_HOURS          整数小时，默认 24，不得小于 24
//   GITHUB_API_URL         可选，必须是 https://api.github.com

import { createHash } from 'node:crypto'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..')

// 只允许这两个精确 origin，任何环境变量都不能扩展到别处。
const GITHUB_API_ORIGIN = 'https://api.github.com'
const GHCR_ORIGIN = 'https://ghcr.io'

const DEFAULT_MIN_AGE_HOURS = 24
const HARD_MIN_AGE_HOURS = 24
const MAX_MIN_AGE_HOURS = 24 * 365 * 5

const PAGE_SIZE = 100
const MAX_PAGES = 100
const MAX_MANIFESTS = 5000
const DELETE_INTERVAL_MS = 400
const REQUEST_TIMEOUT_MS = 30000

// 读取重试（含 429 至少 20 秒退避）；DELETE 不在结果不明时重试。
const READ_RETRY_LIMIT = 4
const RETRY_BASE_MS = 2000
const RETRY_MAX_MS = 15000
const RATE_LIMIT_MIN_BACKOFF_MS = 20000

const PLAN_FILE = 'ghcr-cleanup-plan.json'
const RESULT_FILE = 'ghcr-cleanup-result.json'
const PUBLISH_WORKFLOW_FILE = 'docker-image.yml'

// 有这些状态的运行表示发布仍在进行，禁止删除。
const ACTIVE_RUN_STATUSES = ['queued', 'in_progress', 'waiting', 'pending', 'requested']

const MANIFEST_ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.docker.distribution.manifest.v2+json',
  'application/vnd.oci.artifact.manifest.v1+json',
].join(', ')

const INDEX_MEDIA_TYPES = new Set([
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
])

const IMAGE_MEDIA_TYPES = new Set([
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
])

const ARTIFACT_MEDIA_TYPES = new Set(['application/vnd.oci.artifact.manifest.v1+json'])

// buildx 的证明文件通过该注解指向它描述的镜像清单。
const REFERENCE_DIGEST_ANNOTATION = 'vnd.docker.reference.digest'

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/
const PACKAGE_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,98})$/

let resultWritten = false

// 用函数抛错，避免 class 的暂时性死区。
function FatalError(message) {
  const error = new Error(message)
  error.name = 'FatalError'
  error.isFatal = true
  return error
}

function fatalMessage(error) {
  if (error && error.isFatal) return error.message
  return describeError(error)
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

function start() {
  main().catch((error) => {
    const message = fatalMessage(error)
    console.error(`清理失败：${message}`)
    if (!resultWritten) {
      safeWriteResult({
        ok: false,
        mode: 'aborted',
        error: message,
        finishedAt: new Date().toISOString(),
        deleted: [],
      })
    }
    process.exitCode = 1
  })
}

async function main() {
  if (process.argv.includes('--summary')) {
    writeStepSummary()
    return
  }

  const config = readConfig()
  log(
    `仓库：${config.repositoryFull}；包：${config.packageName}；` +
      `模式：${config.dryRun ? '预览' : '删除'}`
  )

  const github = new GitHubApi(config)
  const ghcr = new GhcrClient(config)

  const location = await resolvePackageLocation(github, config)
  log(`包归属确认通过：${location.apiPath}（owner 类型 ${location.ownerType}）`)

  const versions = await listAllVersions(github, location.apiPath)
  log(`读取到 ${versions.length} 个 active 版本`)

  // 递归读取所有需要的清单（含不在版本列表里的引用）。任何读取失败都会抛出。
  const graph = await buildReferenceGraph(ghcr, versions)
  log(`清单读取完成：${graph.manifests.size} 个`)

  const plan = buildPlan(config, location, versions, graph)

  if (config.dryRun) {
    writeJsonFile(config.planPath, plan)
    safeWriteResult({
      ok: true,
      mode: 'dry_run',
      finishedAt: new Date().toISOString(),
      planSha256: plan.planSha256,
      candidateCount: plan.candidates.length,
      deleted: [],
      note: '预览模式未删除任何版本。执行删除请用相同 min_age_hours 重新运行并传入 plan_sha256。',
    })
    emitOutputs(plan.planSha256, plan.candidates.length, 0)
    log(`预览完成：候选 ${plan.candidates.length} 个，指纹 ${plan.planSha256}`)
    return
  }

  await runDeletion({ config, github, graph, plan, location })
}

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

function readConfig() {
  const repositoryFull = (process.env.GITHUB_REPOSITORY || '').trim()
  const [owner, repo, ...rest] = repositoryFull.split('/')
  if (!owner || !repo || rest.length > 0) {
    throw new FatalError(`GITHUB_REPOSITORY 格式不正确：${repositoryFull || '(空)'}（应为 owner/repo）`)
  }

  const token = (process.env.GITHUB_TOKEN || '').trim()
  if (!token) throw new FatalError('缺少环境变量 GITHUB_TOKEN')

  const dryRun = parseBoolean(process.env.DRY_RUN, true, 'DRY_RUN')
  const minAgeHours = parseMinAgeHours(process.env.MIN_AGE_HOURS)
  const expectedPlanSha256 = normalizeSha256(process.env.EXPECTED_PLAN_SHA256)

  if (!dryRun && !expectedPlanSha256) {
    throw new FatalError(
      'dry_run=false 时必须提供与本次重新计算一致的 plan_sha256（先运行预览取得指纹）'
    )
  }

  // GITHUB_API_URL 只允许是 api.github.com，否则拒绝。
  const apiBase = (process.env.GITHUB_API_URL || GITHUB_API_ORIGIN).replace(/\/+$/, '')
  if (apiBase !== GITHUB_API_ORIGIN) {
    throw new FatalError(
      `GITHUB_API_URL 必须精确为 ${GITHUB_API_ORIGIN}（当前 ${apiBase}），本工具只支持 github.com`
    )
  }

  const ownerLower = owner.toLowerCase()
  const packageName = repo.toLowerCase()
  if (!PACKAGE_NAME_PATTERN.test(packageName)) {
    throw new FatalError(`仓库名小写化后不是合法的容器包名：${packageName}`)
  }

  return {
    repositoryFull,
    repositoryLower: `${ownerLower}/${packageName}`,
    owner,
    ownerLower,
    repo,
    packageName,
    token,
    dryRun,
    minAgeHours,
    expectedPlanSha256,
    apiBase,
    ghcrOrigin: GHCR_ORIGIN,
    // 镜像名形如 ghcr.io/xinmang/markvault，用于 GHCR 的 repository 路径。
    imagePath: `${ownerLower}/${packageName}`,
    planPath: resolve(REPO_ROOT, PLAN_FILE),
    resultPath: resolve(REPO_ROOT, RESULT_FILE),
  }
}

function parseBoolean(raw, fallback, name) {
  const value = (raw || '').trim().toLowerCase()
  if (!value) return fallback
  if (['true', '1', 'yes', 'on'].includes(value)) return true
  if (['false', '0', 'no', 'off'].includes(value)) return false
  throw new FatalError(`${name} 取值无法识别：${raw}（应为 true 或 false）`)
}

function parseMinAgeHours(raw) {
  const value = (raw || '').trim()
  if (!value) return DEFAULT_MIN_AGE_HOURS
  if (!/^[0-9]+$/.test(value)) {
    throw new FatalError(`MIN_AGE_HOURS 必须是整数小时：${value}`)
  }
  const hours = Number.parseInt(value, 10)
  if (!Number.isSafeInteger(hours) || hours < HARD_MIN_AGE_HOURS) {
    throw new FatalError(
      `MIN_AGE_HOURS 不得小于 ${HARD_MIN_AGE_HOURS} 小时（当前${value}），避免误删仍在构建或刚上传的内容`
    )
  }
  if (hours > MAX_MIN_AGE_HOURS) {
    throw new FatalError(`MIN_AGE_HOURS 过大：${value}`)
  }
  return hours
}

function normalizeSha256(raw) {
  const value = (raw || '').trim().toLowerCase()
  if (!value) return ''
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new FatalError('EXPECTED_PLAN_SHA256 必须是 64 位十六进制 SHA256 字符串')
  }
  return value
}

// ---------------------------------------------------------------------------
// GitHub REST 客户端（Authorization 只发 api.github.com）
// ---------------------------------------------------------------------------

class GitHubApi {
  constructor(config) {
    this.config = config
    this.apiBase = config.apiBase
  }

  async request(path, { method = 'GET' } = {}) {
    const url = `${this.apiBase}${path}`
    assertOrigin(url, 'https://api.github.com')

    return fetchWithRetry(url, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.config.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'markvault-ghcr-cleanup',
      },
      // DELETE 不重试：网络结果不明的重复删除会让报告与事实不符。
      retryLimit: method === 'DELETE' ? 0 : READ_RETRY_LIMIT,
    })
  }

  async requestJson(path) {
    const response = await this.request(path)
    if (!response.ok) {
      const detail = await safeErrorDetail(response)
      throw new FatalError(`GitHub API 请求失败：${path} → HTTP ${response.status}${detail}`)
    }
    try {
      return await response.json()
    } catch (error) {
      throw new FatalError(`GitHub API 返回无法解析的 JSON：${path}（${describeError(error)}）`)
    }
  }
}

// 只校验精确的 https origin，绝不根据 URL 自身反推可信集合。
function assertOrigin(url, expectedOrigin) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new FatalError('内部错误：构造出了无法解析的地址')
  }
  if (parsed.origin !== expectedOrigin) {
    throw new FatalError(`拒绝向 ${parsed.origin} 发请求（只允许 ${expectedOrigin}）`)
  }
}

async function safeErrorDetail(response) {
  try {
    const text = await response.text()
    if (!text) return ''
    const parsed = JSON.parse(text)
    const message = typeof parsed?.message === 'string' ? parsed.message.slice(0, 200) : ''
    return message ? `（${message}）` : ''
  } catch {
    return ''
  }
}

// 读取可退避重试（429 至少 20 秒）；DELETE 传 retryLimit=0，不做结果不明的重试。
async function fetchWithRetry(url, { retryLimit, ...init }) {
  let attempt = 0
  for (;;) {
    let response
    try {
      response = await fetch(url, { ...init, redirect: 'manual', signal: timeoutSignal() })
    } catch (error) {
      if (attempt >= retryLimit) {
        throw new FatalError(
          `网络请求失败（${init.method || 'GET'} ${safeUrlForLog(url)}）：${describeError(error)}`
        )
      }
      await sleep(retryDelayMs(attempt, 0))
      attempt += 1
      continue
    }

    if (response.status === 429 || response.status === 408 || response.status >= 500) {
      if (attempt >= retryLimit) return response
      const retryAfter = readRetryAfterMs(response.headers)
      await sleep(retryDelayMs(attempt, retryAfter))
      attempt += 1
      continue
    }

    return response
  }
}

function timeoutSignal() {
  return AbortSignal.timeout(REQUEST_TIMEOUT_MS)
}

function readRetryAfterMs(headers) {
  const retryAfter = (headers.get('retry-after') || '').trim()
  if (/^[0-9]+$/.test(retryAfter)) return Number.parseInt(retryAfter, 10) * 1000
  const reset = (headers.get('x-ratelimit-reset') || '').trim()
  if (/^[0-9]+$/.test(reset)) {
    const remaining = Number.parseInt(reset, 10) * 1000 - Date.now()
    return remaining > 0 ? Math.min(remaining, 60000) : 0
  }
  return 0
}

function retryDelayMs(attempt, retryAfterMs) {
  const backoff = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS)
  return Math.max(backoff, retryAfterMs, RATE_LIMIT_MIN_BACKOFF_MS)
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms))
}

// ---------------------------------------------------------------------------
// 包归属判定
// ---------------------------------------------------------------------------

async function resolvePackageLocation(github, config) {
  const repoInfo = await github.requestJson(`/repos/${config.owner}/${config.repo}`)
  if (String(repoInfo?.full_name || '').toLowerCase() !== config.repositoryLower) {
    throw new FatalError(
      `仓库信息与 GITHUB_REPOSITORY 不一致：${repoInfo?.full_name || '(空)'} ≠ ${config.repositoryFull}`
    )
  }

  const ownerType = String(repoInfo?.owner?.type || '').toLowerCase()
  let ownerPrefix
  if (ownerType === 'user') {
    ownerPrefix = `/users/${encodeURIComponent(config.owner)}`
  } else if (ownerType === 'organization') {
    ownerPrefix = `/orgs/${encodeURIComponent(config.owner)}`
  } else {
    throw new FatalError(`无法识别的 owner 类型：${ownerType || '(空)'}，拒绝继续`)
  }

  const apiPath = `${ownerPrefix}/packages/container/${encodeURIComponent(config.packageName)}`
  const packageInfo = await github.requestJson(apiPath)
  assertPackageBelongsToRepo(config, packageInfo)

  return { apiPath, ownerType }
}

// packageInfo.name 是短包名；关联仓库看 repository.full_name。
function assertPackageBelongsToRepo(config, packageInfo) {
  if (!packageInfo || typeof packageInfo !== 'object') {
    throw new FatalError('无法读取包信息，拒绝继续')
  }

  const infoName = String(packageInfo.name || '')
  if (infoName.toLowerCase() !== config.packageName) {
    throw new FatalError(
      `包名不匹配：期望短包名 ${config.packageName}，实际 ${infoName || '(空)'}`
    )
  }

  const packageType = String(packageInfo.package_type || '').toLowerCase()
  if (packageType && packageType !== 'container') {
    throw new FatalError(`包类型不是容器镜像：${packageType}`)
  }

  const repositoryFull = String(packageInfo?.repository?.full_name || '')
  if (!repositoryFull) {
    throw new FatalError(
      '该包没有关联仓库（repository 为空），可能属于其他来源或已解除关联，拒绝清理'
    )
  }
  if (repositoryFull.toLowerCase() !== config.repositoryLower) {
    throw new FatalError(
      `包关联的仓库不是当前仓库：${repositoryFull} ≠ ${config.repositoryFull}，拒绝清理`
    )
  }
}

// ---------------------------------------------------------------------------
// 版本列表
// ---------------------------------------------------------------------------

// 标准化版本对象：tags 只从 metadata.container.tags 读取，缺失即 fail closed。
function normalizeVersion(raw, page) {
  if (!raw || typeof raw !== 'object') {
    throw new FatalError(`第 ${page} 页存在结构异常的版本条目`)
  }

  const id = raw.id
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new FatalError(`第 ${page} 页存在缺少合法 id 的版本条目`)
  }

  const digest = String(raw.name || '')
  if (!DIGEST_PATTERN.test(digest)) {
    throw new FatalError(`版本 ${id} 的 name 不是合法 sha256 摘要：${digest || '(空)'}`)
  }

  if (!isValidTimestamp(raw.created_at) || !isValidTimestamp(raw.updated_at)) {
    throw new FatalError(`版本 ${id} 缺少合法的 created_at/updated_at，无法判断年龄`)
  }

  const container = raw?.metadata?.container
  if (!container || typeof container !== 'object' || !Array.isArray(container.tags)) {
    throw new FatalError(
      `版本 ${id} 缺少 metadata.container.tags，无法判断是否含标签，按 fail closed 中止`
    )
  }

  const tags = container.tags.map((tag) => {
    if (typeof tag !== 'string') {
      throw new FatalError(`版本 ${id} 的 metadata.container.tags 含非字符串标签，中止`)
    }
    return tag
  })

  return {
    id,
    digest,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    createdAtMs: Date.parse(raw.created_at),
    updatedAtMs: Date.parse(raw.updated_at),
    tags,
  }
}

function isValidTimestamp(value) {
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Date.parse(value))
}

async function listAllVersions(github, apiPath) {
  const collected = []
  const seenIds = new Set()

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await github.request(`${apiPath}/versions?per_page=${PAGE_SIZE}&page=${page}`)
    if (!response.ok) {
      const detail = await safeErrorDetail(response)
      throw new FatalError(
        `读取版本列表失败（第 ${page} 页）：HTTP ${response.status}${detail}。` +
          '读取失败不会按空列表继续，请检查令牌权限（需要 packages:write）'
      )
    }

    let pageItems
    try {
      pageItems = await response.json()
    } catch (error) {
      throw new FatalError(`第 ${page} 页版本列表不是合法 JSON：${describeError(error)}`)
    }
    if (!Array.isArray(pageItems)) {
      throw new FatalError(`第 ${page} 页版本列表结构异常（期望数组）`)
    }

    if (pageItems.length === 0) {
      if (page === 1) throw new FatalError('版本列表为空，无法确认包状态，中止')
      return collected
    }

    for (const raw of pageItems) {
      const version = normalizeVersion(raw, page)
      if (seenIds.has(version.id)) {
        throw new FatalError(`版本列表出现重复 ID ${version.id}，分页结果不可信，中止`)
      }
      seenIds.add(version.id)
      collected.push(version)
    }

    if (pageItems.length < PAGE_SIZE) return collected
    if (page === MAX_PAGES) {
      throw new FatalError(`版本列表达到 ${MAX_PAGES} 页上限，分页可能不完整，中止`)
    }
  }

  throw new FatalError('版本列表分页异常，中止')
}

// ---------------------------------------------------------------------------
// GHCR 客户端：Basic 凭据只发 ghcr.io/token，pull bearer 只发 ghcr.io
// ---------------------------------------------------------------------------

class GhcrClient {
  constructor(config) {
    this.config = config
    this.bearer = ''
  }

  // 获取 pull bearer。GHCR 的 token 端点在 ghcr.io 上，不在 api.github.com。
  async refreshBearer() {
    const scope = `repository:${this.config.imagePath}:pull`
    const url = `${this.config.ghcrOrigin}/token?service=ghcr.io&scope=${encodeURIComponent(scope)}`
    assertOrigin(url, this.config.ghcrOrigin)

    const basic = Buffer.from(`${this.config.ownerLower}:${this.config.token}`, 'utf8').toString(
      'base64'
    )

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${basic}`,
        Accept: 'application/json',
        'User-Agent': 'markvault-ghcr-cleanup',
      },
      retryLimit: READ_RETRY_LIMIT,
    })

    if (!response.ok) {
      // 不输出响应体，避免任何凭据片段进入日志。
      throw new FatalError(
        `获取 GHCR 拉取令牌失败：HTTP ${response.status}。请确认令牌可读取本仓库的容器包`
      )
    }

    let payload
    try {
      payload = await response.json()
    } catch (error) {
      throw new FatalError(`GHCR 令牌响应不是合法 JSON：${describeError(error)}`)
    }

    const token = typeof payload?.token === 'string' ? payload.token : payload?.access_token
    if (typeof token !== 'string' || token.length < 8) {
      throw new FatalError('GHCR 令牌响应缺少可用 token')
    }

    this.bearer = token
    return token
  }

  // 读取 manifest。401 时刷新一次 bearer 再重试；其他失败一律抛出。
  async fetchManifest(digest) {
    if (!DIGEST_PATTERN.test(digest)) {
      throw new FatalError(`拒绝请求非法摘要：${digest}`)
    }

    const url = `${this.config.ghcrOrigin}/v2/${this.config.imagePath}/manifests/${digest}`
    assertOrigin(url, this.config.ghcrOrigin)

    let refreshed = false
    for (;;) {
      if (!this.bearer) await this.refreshBearer()

      const response = await fetchWithRetry(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.bearer}`,
          Accept: MANIFEST_ACCEPT,
          'User-Agent': 'markvault-ghcr-cleanup',
        },
        retryLimit: READ_RETRY_LIMIT,
      })

      if (response.status === 401 && !refreshed) {
        refreshed = true
        this.bearer = ''
        continue
      }

      if (response.status === 404) {
        throw new FatalError(`清单不存在：${digest}。引用图不完整，拒绝删除`)
      }
      if (!response.ok) {
        throw new FatalError(
          `读取清单失败：${digest} → HTTP ${response.status}。无法确认引用关系时一律不删除`
        )
      }

      let body
      try {
        body = await response.json()
      } catch (error) {
        throw new FatalError(`清单 ${digest} 不是合法 JSON：${describeError(error)}`)
      }

      const headerType = String(response.headers.get('content-type') || '')
        .split(';')[0]
        .trim()
      const mediaType = String(body?.mediaType || headerType || '')

      return { digest, mediaType, body }
    }
  }
}

// ---------------------------------------------------------------------------
// 引用图：递归读取，包含不在版本列表中的被引用 manifest
// ---------------------------------------------------------------------------

// 解析一个 manifest 的引用关系。
// 返回 { forward, referrers }：
//   forward   —— 该对象依赖的对象（index → 子清单），用于「保留根 → 依赖」传播
//   referrers —— 该对象是某个目标的证明/referrer（subject、reference digest），用于反向保护
function parseManifestReferences(digest, mediaType, body) {
  if (!body || typeof body !== 'object') {
    throw new FatalError(`清单 ${digest} 内容为空，无法解析引用关系`)
  }

  const forward = []
  const referrers = []

  if (INDEX_MEDIA_TYPES.has(mediaType)) {
    const children = body.manifests
    if (!Array.isArray(children)) {
      throw new FatalError(`索引清单 ${digest} 缺少 manifests 数组，结构未知，中止`)
    }
    for (const child of children) {
      const childDigest = String(child?.digest || '')
      if (!DIGEST_PATTERN.test(childDigest)) {
        throw new FatalError(`索引清单 ${digest} 含非法子清单摘要：${childDigest || '(空)'}`)
      }
      // index → 子清单：作为依赖传播（保留 index 就保留子清单）。
      forward.push(childDigest)

      // 描述符上的 reference digest 表示「该子清单是它所描述镜像的证明」，
      // 关系挂在 child 上，不归到父索引。
      const ref = child?.annotations?.[REFERENCE_DIGEST_ANNOTATION]
      if (ref !== undefined) {
        if (typeof ref !== 'string' || !DIGEST_PATTERN.test(ref)) {
          throw new FatalError(`索引清单 ${digest} 的子清单注解 ${REFERENCE_DIGEST_ANNOTATION} 非法`)
        }
        referrers.push({ from: childDigest, to: ref })
      }
    }
    return { forward, referrers }
  }

  if (IMAGE_MEDIA_TYPES.has(mediaType) || ARTIFACT_MEDIA_TYPES.has(mediaType)) {
    const subjectDigest = body?.subject?.digest
    if (subjectDigest !== undefined) {
      if (typeof subjectDigest !== 'string' || !DIGEST_PATTERN.test(subjectDigest)) {
        throw new FatalError(`清单 ${digest} 的 subject.digest 非法：${String(subjectDigest)}`)
      }
      referrers.push({ from: digest, to: subjectDigest })
    }
    const annotationRef = body?.annotations?.[REFERENCE_DIGEST_ANNOTATION]
    if (annotationRef !== undefined) {
      if (typeof annotationRef !== 'string' || !DIGEST_PATTERN.test(annotationRef)) {
        throw new FatalError(`清单 ${digest} 的 ${REFERENCE_DIGEST_ANNOTATION} 注解非法`)
      }
      referrers.push({ from: digest, to: annotationRef })
    }
    return { forward, referrers }
  }

  throw new FatalError(
    `清单 ${digest} 的媒体类型不在支持范围内：${mediaType || '(空)'}，结构未知，中止`
  )
}

// 从版本列表出发，递归读取所有被引用的 manifest（含不在版本列表里的 digest）。
async function buildReferenceGraph(ghcr, versions) {
  const manifests = new Map()
  const pending = []
  const enqueued = new Set()

  const enqueue = (digest) => {
    if (enqueued.has(digest)) return
    enqueued.add(digest)
    pending.push(digest)
  }

  for (const version of versions) enqueue(version.digest)

  while (pending.length > 0) {
    const digest = pending.pop()
    const manifest = await ghcr.fetchManifest(digest)
    const { forward, referrers } = parseManifestReferences(
      digest,
      manifest.mediaType,
      manifest.body
    )

    manifests.set(digest, { digest, mediaType: manifest.mediaType, forward, referrers })

    // 子清单可能不在版本列表中，但必须读取，才能继续解析它的引用。
    for (const child of forward) {
      if (!manifests.has(child)) enqueue(child)
    }
    for (const { to } of referrers) {
      if (!manifests.has(to)) enqueue(to)
    }

    if (manifests.size > MAX_MANIFESTS) {
      throw new FatalError(`引用图超过 ${MAX_MANIFESTS} 个清单，中止`)
    }
  }

  const dependencies = new Map(
    [...manifests].map(([digest, manifest]) => [digest, new Set(manifest.forward)])
  )
  const referrersByTarget = new Map()
  for (const manifest of manifests.values()) {
    for (const { from, to } of manifest.referrers) {
      if (!manifests.has(from) || !manifests.has(to)) {
        throw new FatalError('证明关系引用了未读取的清单，拒绝删除')
      }
      // 索引中的证明关系属于描述符指定的子清单，而不是索引自身。
      dependencies.get(from).add(to)
      if (!referrersByTarget.has(to)) referrersByTarget.set(to, new Set())
      referrersByTarget.get(to).add(from)
    }
  }
  return { manifests, dependencies, referrersByTarget }
}

// ---------------------------------------------------------------------------
// 计划构建
// ---------------------------------------------------------------------------

// 保留根：带标签的版本 + 因年龄过近而保留的版本。都沿 forward 依赖递归保护。
function computePlan(config, versions, graph) {
  const now = Date.now()
  const cutoffMs = now - config.minAgeHours * 3600 * 1000

  const taggedRoots = [] // 带标签：永久保留根
  const recentRoots = [] // 因年龄过近保留
  const untaggedOld = [] // 无标签且足够旧，可能成为候选

  for (const version of versions) {
    if (version.tags.length > 0) {
      taggedRoots.push(version)
    } else if (version.createdAtMs >= cutoffMs || version.updatedAtMs >= cutoffMs) {
      recentRoots.push(version)
    } else {
      untaggedOld.push(version)
    }
  }

  // 带标签的对象：自身 + forward 依赖（子清单等）
  const taggedProtected = walkForward(
    graph,
    taggedRoots.map((v) => v.digest)
  )

  // 近期保留的对象同样是保护根：保留它们依赖的旧子清单。
  const recentProtected = walkForward(
    graph,
    recentRoots.map((v) => v.digest)
  )

  // 被证明/referrer 关系引用的目标也要保护，且传递其依赖。
  // 反向关系只为 subject / reference-digest 建立，不把 index-child 反向遍历。
  const referrerProtected = walkReferrersUpward(graph, [
    ...taggedProtected,
    ...recentProtected,
  ])

  const protectedSet = new Set([...taggedProtected, ...recentProtected, ...referrerProtected])

  const candidates = []
  const protectedUntagged = []

  for (const version of untaggedOld) {
    if (protectedSet.has(version.digest)) {
      protectedUntagged.push(version)
    } else {
      candidates.push(version)
    }
  }

  const byDigest = (a, b) => (a.digest < b.digest ? -1 : a.digest > b.digest ? 1 : a.id - b.id)
  candidates.sort(byDigest)
  protectedUntagged.sort(byDigest)
  taggedRoots.sort(byDigest)
  recentRoots.sort(byDigest)

  return {
    now,
    cutoffMs,
    taggedRoots,
    recentRoots,
    candidates,
    protectedUntagged,
    protectedSet,
    taggedProtected,
    recentProtected,
  }
}

// 从一组 digest 出发，沿 forward（index → 子清单）递归收集。
function walkForward(graph, startDigests) {
  const visited = new Set()
  const queue = [...startDigests]

  while (queue.length > 0) {
    const digest = queue.pop()
    if (visited.has(digest)) continue
    visited.add(digest)

    const manifest = graph.manifests.get(digest)
    // 每个 digest 都已读入图，缺失说明逻辑有误，必须失败。
    if (!manifest) {
      throw new FatalError(`引用图缺少清单 ${digest}，中止`)
    }
    for (const child of graph.dependencies.get(digest)) {
      if (!visited.has(child)) queue.push(child)
    }
  }

  return visited
}

// 反向传播：若某对象是保留目标的证明（subject / reference digest），该对象也要保护，
// 并继续保护它自身的 forward 依赖。
function walkReferrersUpward(graph, protectedDigests) {
  // 建立「目标 -> 证明者列表」的反向索引，只来自 referrers（subject / reference digest）。
  const { referrersByTarget } = graph

  const protectedSet = new Set()
  const queue = [...protectedDigests]

  while (queue.length > 0) {
    const digest = queue.pop()
    if (protectedSet.has(digest)) continue
    protectedSet.add(digest)

    // 该目标的证明者（attestation 等）
    for (const referrer of referrersByTarget.get(digest) || []) {
      if (!protectedSet.has(referrer)) queue.push(referrer)
    }

    // 证明者自身的 forward 依赖
    const manifest = graph.manifests.get(digest)
    if (!manifest) throw new FatalError(`引用图缺少清单 ${digest}，中止`)
    for (const child of graph.dependencies.get(digest)) {
      if (!protectedSet.has(child)) queue.push(child)
    }
  }

  return protectedSet
}

// 规范化 JSON：对象键排序，保证指纹稳定。
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function buildPlan(config, location, versions, graph) {
  const decision = computePlan(config, versions, graph)

  // 指纹只含稳定决策字段：不含 generatedAt / 当前时间 / cutoff 时间戳。
  const fingerprintInput = {
    schema: 'markvault-ghcr-cleanup-plan/v2',
    repository: config.repositoryLower,
    package: config.packageName,
    ownerType: location.ownerType,
    minAgeHours: config.minAgeHours,
    taggedRoots: decision.taggedRoots.map((v) => ({
      digest: v.digest,
      tags: [...v.tags].sort(),
    })),
    recentRootDigests: decision.recentRoots.map((v) => v.digest).sort(),
    protectedDigests: [...decision.protectedSet].sort(),
    candidateIds: decision.candidates.map((v) => ({ id: v.id, digest: v.digest })),
    counts: {
      total: versions.length,
      tagged: decision.taggedRoots.length,
      recentRetained: decision.recentRoots.length,
      protectedUntagged: decision.protectedUntagged.length,
      candidates: decision.candidates.length,
    },
  }

  const planSha256 = sha256Hex(canonicalJson(fingerprintInput))

  return {
    schema: 'markvault-ghcr-cleanup-plan/v2',
    generatedAt: new Date().toISOString(),
    repository: config.repositoryFull,
    package: `ghcr.io/${config.imagePath}`,
    packageName: config.packageName,
    ownerType: location.ownerType,
    packageApiPath: location.apiPath,
    dryRun: config.dryRun,
    minAgeHours: config.minAgeHours,
    planSha256,
    counts: fingerprintInput.counts,
    candidates: decision.candidates.map((v) => ({
      id: v.id,
      digest: v.digest,
      created_at: v.createdAt,
      updated_at: v.updatedAt,
    })),
    // 区分：近期因年龄保留 vs 无标签但被引用图保护
    recentRetainedDigests: decision.recentRoots.map((v) => v.digest),
    protectedUntaggedDigests: decision.protectedUntagged.map((v) => v.digest),
    taggedRoots: fingerprintInput.taggedRoots,
    fingerprintFields: fingerprintInput,
  }
}

// ---------------------------------------------------------------------------
// 删除流程
// ---------------------------------------------------------------------------

// 先删除引用者，再删除其依赖，避免中断后留下指向已删子清单的孤立索引。
function orderDeletionCandidates(candidates, graph) {
  const byDigest = new Map(candidates.map((item) => [item.digest, item]))
  const incoming = new Map(candidates.map((item) => [item.digest, 0]))
  for (const item of candidates) {
    for (const dependency of graph.dependencies.get(item.digest)) {
      if (incoming.has(dependency)) incoming.set(dependency, incoming.get(dependency) + 1)
    }
  }
  const ready = candidates.filter((item) => incoming.get(item.digest) === 0)
  const ordered = []
  for (let index = 0; index < ready.length; index += 1) {
    const item = ready[index]
    ordered.push(item)
    for (const dependency of graph.dependencies.get(item.digest)) {
      if (!incoming.has(dependency)) continue
      incoming.set(dependency, incoming.get(dependency) - 1)
      if (incoming.get(dependency) === 0) ready.push(byDigest.get(dependency))
    }
  }
  if (ordered.length !== candidates.length) {
    throw new FatalError('候选清单存在循环引用或重复摘要，拒绝删除')
  }
  return ordered
}

async function runDeletion({ config, github, graph, plan, location }) {
  // 指纹先核对：不一致则零删除。
  writeJsonFile(config.planPath, plan)

  if (config.expectedPlanSha256 !== plan.planSha256) {
    const message =
      '计划指纹不一致，已零删除。当前现场重算的指纹与输入的 plan_sha256 不同，' +
      '可能期间有标签/版本变化；请重新运行预览并核对清单。'
    writeJsonFile(config.resultPath, {
      ok: false,
      mode: 'aborted',
      finishedAt: new Date().toISOString(),
      planSha256: plan.planSha256,
      expectedPlanSha256: config.expectedPlanSha256,
      candidateCount: plan.candidates.length,
      deleted: [],
      error: message,
    })
    resultWritten = true
    emitOutputs(plan.planSha256, plan.candidates.length, 0)
    throw new FatalError(message)
  }

  log(`计划指纹核对通过：${plan.planSha256}`)
  emitOutputs(plan.planSha256, plan.candidates.length, 0)

  if (plan.candidates.length === 0) {
    writeJsonFile(config.resultPath, {
      ok: true,
      mode: 'delete',
      finishedAt: new Date().toISOString(),
      planSha256: plan.planSha256,
      candidateCount: 0,
      deleted: [],
      note: '没有可删除的无标签版本。',
    })
    resultWritten = true
    emitOutputs(plan.planSha256, 0, 0)
    log('没有可删除的候选版本。')
    return
  }

  // 执行前确认发布工作流没有进行中的运行。
  await assertNoActivePublicationRun(github, config)

  const deleted = []
  const deletionOrder = orderDeletionCandidates(plan.candidates, graph)
  // 每成功一条就落盘，保证中断时结果准确。
  const flushResult = (extra) => {
    resultWritten = true
    emitOutputs(plan.planSha256, plan.candidates.length, deleted.length)
    writeJsonFile(config.resultPath, {
      ok: false,
      mode: 'delete',
      finishedAt: new Date().toISOString(),
      planSha256: plan.planSha256,
      candidateCount: plan.candidates.length,
      deleted,
      ...extra,
    })
  }

  for (let index = 0; index < deletionOrder.length; index += 1) {
    const target = deletionOrder[index]

    // 每条删除前都重新确认现场：根集合未变、仍无 tag、仍满足年龄。
    if (index > 0) await sleep(DELETE_INTERVAL_MS)
    let response
    try {
      await assertNoActivePublicationRun(github, config)
      await confirmCandidateStillValid({ github, graph, config, plan, location, target })
      response = await github.request(`${location.apiPath}/versions/${target.id}`, {
        method: 'DELETE',
      })
    } catch (error) {
      flushResult({
        error: `版本 ${target.id} 的现场复核或删除未完成，已停止：${fatalMessage(error)}`,
        failures: [{ id: target.id, digest: target.digest, error: fatalMessage(error) }],
      })
      emitOutputs(plan.planSha256, plan.candidates.length, deleted.length)
      throw new FatalError(`删除中断：已删除 ${deleted.length} 个，详见 ${RESULT_FILE}`)
    }

    // 只有 204 才算成功。
    if (response.status !== 204) {
      const detail = await safeErrorDetail(response)
      flushResult({
        error: `删除版本 ${target.id} 失败：HTTP ${response.status}${detail}`,
        failures: [
          { id: target.id, digest: target.digest, error: `HTTP ${response.status}${detail}` },
        ],
      })
      emitOutputs(plan.planSha256, plan.candidates.length, deleted.length)
      throw new FatalError(
        `删除中断：已删除 ${deleted.length} 个，版本 ${target.id} 失败；详见 ${RESULT_FILE}`
      )
    }

    deleted.push({ id: target.id, digest: target.digest, deletedAt: new Date().toISOString() })
    log(`已删除版本 ${target.id}（${target.digest}）`)
    flushResult({})
  }

  writeJsonFile(config.resultPath, {
    ok: true,
    mode: 'delete',
    finishedAt: new Date().toISOString(),
    planSha256: plan.planSha256,
    candidateCount: plan.candidates.length,
    deletedCount: deleted.length,
    deleted,
    failures: [],
    note: '全部候选版本已删除。',
  })
  resultWritten = true
  emitOutputs(plan.planSha256, plan.candidates.length, deleted.length)
  log(`删除完成：共 ${deleted.length} 个版本。`)
}

// 删除单条前重算现场，确认整体根集合与当前候选都未变化。
async function confirmCandidateStillValid({ github, graph, config, plan, location, target }) {
  const versions = await listAllVersions(github, location.apiPath)
  // 清单内容由摘要固定，可复用已经完整读取的图；出现新摘要必须重新预览。
  if (versions.some((version) => !graph.manifests.has(version.digest))) {
    throw new FatalError('版本列表出现新摘要，已停止后续删除；请重新运行预览')
  }
  const fresh = buildPlan({ ...config, dryRun: config.dryRun }, location, versions, graph)

  const freshRoots = new Set(fresh.fingerprintFields.taggedRoots.map((r) => r.digest))
  const planRoots = new Set(plan.fingerprintFields.taggedRoots.map((r) => r.digest))
  const rootsEqual =
    freshRoots.size === planRoots.size && [...planRoots].every((d) => freshRoots.has(d))
  if (!rootsEqual) {
    throw new FatalError('删除前复核发现带标签根集合已变化，已停止后续删除；请重新运行预览')
  }

  const freshRecent = new Set(fresh.fingerprintFields.recentRootDigests)
  const planRecent = new Set(plan.fingerprintFields.recentRootDigests)
  const recentEqual =
    freshRecent.size === planRecent.size && [...planRecent].every((d) => freshRecent.has(d))
  if (!recentEqual) {
    throw new FatalError('删除前复核发现近期保留集合已变化，已停止后续删除；请重新运行预览')
  }

  // 本轮已成功删除的候选会正常改变总指纹；逐条复核只确认保留根与当前目标仍安全。
  if (!fresh.candidates.some((candidate) => candidate.id === target.id && candidate.digest === target.digest)) {
    throw new FatalError(`版本 ${target.id} 已不再属于安全候选，已停止后续删除`)
  }

  const live = versions.find((v) => v.id === target.id)
  if (!live) {
    throw new FatalError(`候选版本 ${target.id} 已不存在，已停止后续删除；请重新运行预览`)
  }
  if (live.tags.length > 0) {
    throw new FatalError(`候选版本 ${target.id} 已被打上标签，已停止后续删除`)
  }

  const cutoffMs = Date.now() - config.minAgeHours * 3600 * 1000
  if (live.createdAtMs >= cutoffMs || live.updatedAtMs >= cutoffMs) {
    throw new FatalError(
      `候选版本 ${target.id} 已不满足 ${config.minAgeHours} 小时年龄阈值，已停止后续删除`
    )
  }
}

// 用 status 过滤查询各活动状态，逐一核实响应完整且为空。
async function assertNoActivePublicationRun(github, config) {
  for (const status of ACTIVE_RUN_STATUSES) {
    const path =
      `/repos/${config.owner}/${config.repo}/actions/workflows/${PUBLISH_WORKFLOW_FILE}` +
      `/runs?status=${encodeURIComponent(status)}&per_page=100`

    let payload
    try {
      payload = await github.requestJson(path)
    } catch (error) {
      throw new FatalError(
        `无法确认发布工作流状态（${fatalMessage(error)}），为安全起见拒绝删除。` +
          '请确认令牌具备 actions:read'
      )
    }

    const runs = payload?.workflow_runs
    if (!Array.isArray(runs)) {
      throw new FatalError(`发布运行列表结构异常（status=${status}），无法确认是否有活动发布，拒绝删除`)
    }
    if (typeof payload.total_count !== 'number') {
      throw new FatalError(`发布运行列表缺少 total_count（status=${status}），拒绝删除`)
    }
    if (runs.length !== payload.total_count) {
      throw new FatalError(
        `发布运行列表不完整（status=${status}：${runs.length}/${payload.total_count}），拒绝删除`
      )
    }

    const active = runs.filter((run) => {
      const st = String(run?.status || '').toLowerCase()
      return st === status
    })
    if (active.length > 0) {
      const sample = active
        .slice(0, 5)
        .map((run) => `#${run.id}(${run.status})`)
        .join('、')
      throw new FatalError(
        `检测到发布工作流仍有进行中的运行：${sample}，已停止清理`
      )
    }
  }
}

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------

// 写入失败必须让流程失败，不能吞掉后继续删除。
function writeJsonFile(path, data) {
  try {
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  } catch (error) {
    throw new FatalError(`写入 ${path} 失败：${describeError(error)}`)
  }
}

function safeWriteResult(data) {
  try {
    writeFileSync(resolve(REPO_ROOT, RESULT_FILE), `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  } catch (error) {
    console.error(`写入结果文件失败：${describeError(error)}`)
  }
}

function emitOutputs(planSha256, candidateCount, deletedCount) {
  outputGithub('plan_sha256', planSha256)
  outputGithub('candidate_count', String(candidateCount))
  outputGithub('deleted_count', String(deletedCount))
}

function outputGithub(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT
  if (!outputFile) return
  try {
    appendFileSync(outputFile, `${name}=${value}\n`, 'utf8')
  } catch (error) {
    console.error(`写入 GITHUB_OUTPUT 失败：${describeError(error)}`)
  }
}

function log(message) {
  console.log(`[ghcr-cleanup] ${message}`)
}

// 只输出 origin + path，绝不带查询参数或请求头。
function safeUrlForLog(url) {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return '(无法解析的地址)'
  }
}

function describeError(error) {
  if (!error) return '未知错误'
  if (typeof error === 'string') return error
  const message = error.message ? String(error.message) : String(error)
  return message.slice(0, 500)
}

function readJsonIfExists(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    if (error && error.code === 'ENOENT') return null
    console.error(`读取 ${path} 失败：${describeError(error)}`)
    return null
  }
}

// 读取已落盘的计划/结果，渲染成步骤摘要（不产生网络请求，不含令牌）。
function writeStepSummary() {
  const lines = []
  lines.push('### GHCR 无标签镜像清理')
  lines.push('')

  const dryRunInput = String(process.env.DRY_RUN_INPUT || '').toLowerCase()
  lines.push(
    dryRunInput === 'false'
      ? '- 模式：**执行删除（dry_run=false）**'
      : '- 模式：**预览（dry_run=true，未删除任何版本）**'
  )
  lines.push(`- 年龄阈值：\`${process.env.MIN_AGE_HOURS_INPUT || DEFAULT_MIN_AGE_HOURS}\` 小时`)
  lines.push(`- 计划指纹：\`${process.env.PLAN_SHA256_OUT || '（未生成）'}\``)
  lines.push(`- 候选数量：\`${process.env.CANDIDATE_COUNT_OUT || '0'}\``)
  lines.push(`- 已删除数量：\`${process.env.DELETED_COUNT_OUT || '0'}\``)
  lines.push('')

  const plan = readJsonIfExists(resolve(REPO_ROOT, PLAN_FILE))
  if (plan) {
    const counts = plan.counts || {}
    lines.push('#### 计划概要')
    lines.push('')
    lines.push('| 指标 | 数量 |')
    lines.push('| --- | --- |')
    lines.push(`| 版本总数 | ${counts.total ?? '-'} |`)
    lines.push(`| 带标签（保留根） | ${counts.tagged ?? '-'} |`)
    lines.push(`| 近期保留（年龄不足） | ${counts.recentRetained ?? '-'} |`)
    lines.push(`| 无标签但受引用保护 | ${counts.protectedUntagged ?? '-'} |`)
    lines.push(`| 可删除候选 | ${counts.candidates ?? '-'} |`)
    lines.push('')

    const candidates = Array.isArray(plan.candidates) ? plan.candidates : []
    if (candidates.length > 0) {
      lines.push('#### 候选版本（前 20 条）')
      lines.push('')
      lines.push('| 版本 ID | 摘要 | 创建时间 |')
      lines.push('| --- | --- | --- |')
      for (const item of candidates.slice(0, 20)) {
        lines.push(`| ${item.id} | \`${item.digest}\` | ${item.created_at} |`)
      }
      if (candidates.length > 20) {
        lines.push('')
        lines.push(`其余 ${candidates.length - 20} 条见 artifact 中的计划文件。`)
      }
      lines.push('')
      lines.push('要真正执行删除，请重新运行本工作流并设置：')
      lines.push('')
      lines.push('- `dry_run` = false')
      lines.push(`- \`expected_plan_sha256\` = \`${plan.planSha256 || ''}\``)
      lines.push(`- \`min_age_hours\` = ${plan.minAgeHours ?? DEFAULT_MIN_AGE_HOURS}（必须与本次一致）`)
    }
  }

  const result = readJsonIfExists(resolve(REPO_ROOT, RESULT_FILE))
  if (result) {
    lines.push('')
    lines.push('#### 执行结果')
    lines.push('')
    lines.push(`- 状态：${result.ok ? '成功' : '失败/中止'}`)
    if (result.error) lines.push(`- 原因：${String(result.error).slice(0, 300)}`)
    const deleted = Array.isArray(result.deleted) ? result.deleted : []
    lines.push(`- 已删除：${deleted.length} 个`)
    const failures = Array.isArray(result.failures) ? result.failures : []
    if (failures.length > 0) {
      lines.push('- 失败条目：')
      for (const item of failures) {
        lines.push(`  - 版本 ${item.id}：${String(item.error).slice(0, 200)}`)
      }
    }
    if (result.note) lines.push(`- 说明：${result.note}`)
  }

  const text = `${lines.join('\n')}\n`
  const summaryFile = process.env.GITHUB_STEP_SUMMARY
  if (summaryFile) {
    try {
      appendFileSync(summaryFile, text, 'utf8')
      return
    } catch (error) {
      console.error(`写入步骤摘要失败：${describeError(error)}`)
    }
  }
  console.log(text)
}

// 所有声明就绪后再启动，避免 class/const 的暂时性死区。
start()
