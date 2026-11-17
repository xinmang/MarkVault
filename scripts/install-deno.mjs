#!/usr/bin/env node
// 固定官方发布资产和摘要；只安装项目所需运行时，不执行远端安装脚本。
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
const version = '2.9.8'
const assets = {
  'darwin-arm64': ['deno-aarch64-apple-darwin.zip', '9f0bf660393da2eaff044cdc7444cb08c73f235849b61d224d825a194ce7c98e'],
  'darwin-x64': ['deno-x86_64-apple-darwin.zip', '4b2f5edd2639b7470f034238b321d7002d8dfb4726d8558f52c17afac370eb2c'],
  'win32-x64': ['deno-x86_64-pc-windows-msvc.zip', 'cba84b26e0df5ae7f74fc66b86a95b866872a86292ebd84fa1e959927edd93bf'],
  'linux-x64': ['deno-x86_64-unknown-linux-gnu.zip', 'e890975bc2549807bbcc0b584ffafda72cc7c93349dd99c80483dd784f6c4609'],
  'linux-arm64': ['deno-aarch64-unknown-linux-gnu.zip', 'd49596c20b9788cf8f5d8ddf644103d4bde56ed239753f0bdb92ba9361d51905'],
}
const selected = assets[process.platform + '-' + process.arch]
if (!selected) throw new Error('此平台暂未配置运行时摘要')
const directory = resolve(process.argv[2] ?? '.data/tools/deno')
await mkdir(directory, { recursive: true })
const response = await fetch('https://github.com/denoland/deno/releases/download/v' + version + '/' + selected[0], { signal: AbortSignal.timeout(120000) })
if (!response.ok) throw new Error('运行时下载失败')
const bytes = Buffer.from(await response.arrayBuffer())
if (createHash('sha256').update(bytes).digest('hex') !== selected[1]) throw new Error('运行时摘要不匹配')
const archive = resolve(directory, 'deno.zip')
await writeFile(archive, bytes)
const result = process.platform === 'win32'
  ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:MV_DENO_ARCHIVE -DestinationPath $env:MV_DENO_TARGET -Force'], { windowsHide: true, stdio: 'inherit', env: { ...process.env, MV_DENO_ARCHIVE: archive, MV_DENO_TARGET: directory } })
  : spawnSync('unzip', ['-o', archive, '-d', directory], { stdio: 'inherit' })
if (result.error || result.status !== 0) throw new Error('运行时解压失败')
console.log('Deno ' + version + ': ' + directory)
