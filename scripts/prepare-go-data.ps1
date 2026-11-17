param(
  [string]$DataDirectory = "",
  [ValidateNotNullOrEmpty()][string]$Image = "ghcr.io/xinmang/markvault:latest"
)

# 用途：在 Windows 宿主机上把一份「完整的 Go 迁移副本」的属主与权限
# 调整为容器用户 1000:1000，让以只读根文件系统运行的非 root 容器可以写入。
# 脚本只处理数据目录这一处挂载，不读取、不打印任何密钥内容。

$ErrorActionPreference = "Stop"

# 比较用的大小写不敏感相等判断。
function Test-PathEquals {
  param([string]$First, [string]$Second)
  return [string]::Equals($First, $Second, [System.StringComparison]::OrdinalIgnoreCase)
}

# 判断 Second 是否等于 First 或位于 First 之下（不含兄弟目录）。
function Test-PathUnder {
  param([string]$First, [string]$Second)
  if (Test-PathEquals $First $Second) { return $true }
  foreach ($separatorChar in @([char]'\', [char]'/')) {
    if ($Second.StartsWith($First + $separatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
      return $true
    }
  }
  return $false
}

# 两个路径相同、互为祖先或互为后代时都视为重叠。
function Test-OverlapPath {
  param([string]$First, [string]$Second)
  if (Test-PathUnder $First $Second) { return $true }
  if (Test-PathUnder $Second $First) { return $true }
  return $false
}

# 把 Windows 路径标准化成「盘符:\」开头、反斜杠分隔、去掉尾部反斜杠的形式。
# GetFullPath 只做语法标准化，不解析盘符映射或符号链接。
function ConvertTo-NormalizedWindowsPath {
  param([string]$Path)
  $full = [System.IO.Path]::GetFullPath($Path)
  return $full.TrimEnd('\', '/')
}

# 把容器绑定挂载源转换成标准化 Windows 路径，便于与目标目录做字符串重叠比较。
# 只识别明确的 Windows 盘符路径和 Docker Desktop 常见前缀；
# 其他形式（Linux 宿主路径、无法判断的映射）返回空字符串，由调用方失败退出。
function ConvertFrom-ContainerSource {
  param([string]$Source)
  if ([string]::IsNullOrEmpty($Source)) { return "" }
  $value = $Source.TrimEnd('/')
  if ($value.Length -eq 0) { return "" }

  # 原生盘符路径：C:\...
  if ($value -match '^[A-Za-z]:[\\/]') { return (ConvertTo-NormalizedWindowsPath $value) }

  # Docker Desktop 常见挂载前缀：/run/desktop/mnt/host/c/...、/host_mnt/c/...、/mnt/c/...
  foreach ($prefix in @('/run/desktop/mnt/host/', '/host_mnt/', '/mnt/')) {
    if ($value.StartsWith($prefix, [System.StringComparison]::Ordinal)) {
      $rest = $value.Substring($prefix.Length)
      if ($rest -notmatch '^([A-Za-z])(/[^/].*)?$') { return "" }
      $drive = $Matches[1]
      $tail = if ($Matches[2]) { $Matches[2].Substring(1).Replace('/', '\') } else { "" }
      $windowsPath = if ($tail) { "$($drive):\$tail" } else { "$($drive):\" }
      return (ConvertTo-NormalizedWindowsPath $windowsPath)
    }
  }
  return ""
}

# 从目标目录自身逐级到盘根，拒绝任何重解析点。
function Assert-NoReparsePointInAncestors {
  param([string]$Path)
  $current = $Path
  while ($true) {
    $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
    if (-not $item) { throw "无法检查路径是否存在：$current" }
    if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
      throw "路径 $current 是重解析点（符号链接、junction 或映射目录），拒绝处理"
    }
    # 直接使用 Get-Item 返回的 DirectoryInfo.Parent，避免 Split-Path 参数集解析问题。
    $parentInfo = $item.Parent
    if (-not $parentInfo) { break }
    $parent = $parentInfo.FullName
    if (-not $parent -or (Test-PathEquals $parent $current)) { break }
    $current = $parent
  }
}

# 用不跟随链接的显式目录遍历检查所有后代：
# 逐项判断属性，遇到重解析点立即拒绝，绝不先递归进入链接。
function Assert-NoReparsePointInDescendants {
  param([string]$Path)
  $pending = [System.Collections.Generic.Stack[string]]::new()
  $pending.Push($Path)
  while ($pending.Count -gt 0) {
    $current = $pending.Pop()
    $children = $null
    try {
      $children = @(Get-ChildItem -LiteralPath $current -Force -ErrorAction Stop)
    }
    catch {
      throw "无法枚举目录 $current：$($_.Exception.Message)。已停止处理，未修改任何权限"
    }
    foreach ($child in $children) {
      if (-not $child) { throw "无法判断目录项类型：$current" }
      if ($child.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        throw "数据目录内存在重解析点（符号链接或 junction）：$($child.FullName)，拒绝处理"
      }
      if ($child.PSIsContainer) { $pending.Push($child.FullName) }
    }
  }
}

# 校验作为 Docker --mount source 字段使用的路径：
# 拒绝控制字符以及会破坏字段分隔的逗号与双引号，避免挂载参数注入。
function Assert-MountSafePath {
  param([string]$Path)
  if ($Path -match '[\x00-\x1f\x7f]') {
    throw "数据目录路径含控制字符，无法安全传给 docker --mount"
  }
  if ($Path.Contains(',') -or $Path.Contains('"')) {
    throw "数据目录路径含逗号或双引号，会破坏 docker --mount 的字段分隔，请改到不含这些字符的目录"
  }
}

# 镜像参数不得以连字符开头，也不得含控制字符，避免被解释成其他 docker 选项。
function Assert-SafeImageReference {
  param([string]$Image)
  if ($Image -match '[\x00-\x1f\x7f]') { throw "镜像名含控制字符，拒绝执行" }
  if ($Image.StartsWith('-')) { throw "镜像名不能以连字符开头，拒绝执行" }
  if ($Image.Contains(',')) { throw "镜像名不能含逗号，拒绝执行" }
}

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path.TrimEnd('\', '/')
if (-not $DataDirectory) { $DataDirectory = Join-Path $repoRoot "data/go" }
$resolved = Resolve-Path -LiteralPath $DataDirectory -ErrorAction SilentlyContinue
if (-not $resolved) { throw "数据目录不存在：$DataDirectory" }
$dataPath = ConvertTo-NormalizedWindowsPath $resolved.Path
if (-not (Test-Path -LiteralPath $dataPath -PathType Container)) {
  throw "目标不是目录：$dataPath"
}

# 外层安全检查：拒绝仓库根、旧版 data 根、磁盘根目录。
$legacyPath = ConvertTo-NormalizedWindowsPath (Join-Path $repoRoot "data")
$rootPathRaw = [System.IO.Path]::GetPathRoot($dataPath)
$rootPath = if ($rootPathRaw) { $rootPathRaw.TrimEnd('\', '/') } else { "" }
if ((Test-PathEquals $dataPath $repoRoot) -or
    (Test-PathEquals $dataPath $legacyPath) -or
    ($rootPath -and (Test-PathEquals $dataPath $rootPath))) {
  throw "拒绝修改仓库根目录、旧版 data 目录或磁盘根目录的权限"
}

Assert-MountSafePath $dataPath
Assert-SafeImageReference $Image

# 目标自身及其全部祖先都不能是重解析点（含盘根、junction、符号链接目录）。
Assert-NoReparsePointInAncestors $dataPath
# 后代用不跟随链接的显式遍历检查，任何重解析点都直接拒绝。
Assert-NoReparsePointInDescendants $dataPath

# 只接受完整的 Go 迁移副本。
foreach ($relativePath in @("migration-report.json", "database/markvault.sqlite", "config/runtime.env", "objects")) {
  if (-not (Test-Path -LiteralPath (Join-Path $dataPath $relativePath))) {
    throw "目录不是完整的 Go 迁移副本，缺少 $relativePath"
  }
}
$null = Get-Content -LiteralPath (Join-Path $dataPath "migration-report.json") -Raw | ConvertFrom-Json

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "未找到 docker 命令，请先安装并启动 Docker"
}

# 修改权限前检查是否有容器正在使用与目标目录重叠的路径
# （相同、祖先或后代都要拒绝，避免改动到别的容器正在读写的数据）。
# 容器内看到的 /run/desktop/mnt/host/c/... 等挂载源会先转换成同一 Windows 路径再比较。
$runningContainers = @(docker ps --format '{{.ID}}')
if ($LASTEXITCODE -ne 0) { throw "无法检查 Docker 运行状态" }
foreach ($containerID in $runningContainers) {
  if (-not $containerID) { continue }
  $mountJSON = docker inspect --format '{{json .Mounts}}' $containerID
  if ($LASTEXITCODE -ne 0) { throw "无法检查容器挂载：$containerID" }
  if (-not $mountJSON) { continue }
  foreach ($mount in @($mountJSON | ConvertFrom-Json)) {
    if (-not $mount) { continue }
    if (-not ($mount.PSObject.Properties.Name -contains 'Type')) { continue }
    if (-not ($mount.PSObject.Properties.Name -contains 'Source')) { continue }
    if ($mount.Type -ne "bind" -or -not $mount.Source) { continue }
    $mountedPath = ConvertFrom-ContainerSource ([string]$mount.Source)
    if (-not $mountedPath) {
      throw "容器 $containerID 的绑定挂载源 $($mount.Source) 无法可靠识别为 Windows 路径，无法确认是否与目标目录重叠。请先停止相关容器（如 docker compose stop app）再重试"
    }
    if (Test-OverlapPath -First $mountedPath -Second $dataPath) {
      throw "有容器（$containerID）正在使用与 Go 数据目录重叠的路径 $mountedPath，请先运行 docker compose stop app 再重试"
    }
  }
}

# 在普通 Go 运行镜像的 /bin/sh 中先遍历校验，再调整属主与权限。
# 数据目录只通过 --mount 传入，不拼接进 shell 脚本；脚本使用单引号字符串，不做变量插值。
$prepareScript = @'
set -eu
if [ ! -d /go-data ]; then
  echo "未找到挂载到 /go-data 的数据目录" >&2
  exit 1
fi
invalid=$(find -P /go-data ! -type f ! -type d -print)
if [ -n "$invalid" ]; then
  printf '%s\n' "$invalid" >&2
  echo "Go 数据目录含符号链接或特殊文件，已停止处理" >&2
  exit 2
fi
find -P /go-data -depth -type d -exec chown --no-dereference 1000:1000 {} +
find -P /go-data -depth -type f -exec chown --no-dereference 1000:1000 {} +
find -P /go-data -depth -type d -exec chmod 700 {} +
find -P /go-data -depth -type f -exec chmod 600 {} +
total=$(find -P /go-data | wc -l)
echo "已准备 Go 数据目录：共 $total 个路径，属主 1000:1000，目录 0700、文件 0600"
'@

# 参数以数组逐个传入，不经过 eval 或字符串拼接；只挂载这一个目录。
$dockerArgs = @(
  "run", "--rm", "--pull=never", "--network", "none", "--user", "0:0",
  "--mount", "type=bind,source=$dataPath,target=/go-data",
  "--entrypoint", "/bin/sh", $Image, "-c", $prepareScript
)
& docker @dockerArgs
if ($LASTEXITCODE -ne 0) {
  throw @"
Go 数据目录权限准备失败。
- 镜像必须已在本机存在（脚本使用 --pull=never，且只挂载 $dataPath）。
- 脚本需要镜像内存在 /bin/sh；scratch 形式的离线预构建镜像没有 shell，不能使用，请改用带 shell 的普通 Go 运行镜像。
- 若容器仍在运行并占用该目录，请先执行 docker compose stop app 再重试。
"@
}

Write-Host "数据目录 $dataPath 已准备好，可以用 docker compose up -d --wait 启动。"
