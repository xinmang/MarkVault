param(
  [string]$Image = "markvault:go",
  [string]$GoExecutable = "go",
  [ValidateSet("amd64", "arm64")][string]$Architecture = "amd64",
  [string]$CertificatesFile = "",
  [string]$CertificatesContainer = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$contextDir = Join-Path $repoRoot (".data/go-image-" + [guid]::NewGuid().ToString("N"))
$savedGoOS = $env:GOOS
$savedGoArch = $env:GOARCH
$savedCGO = $env:CGO_ENABLED
Push-Location $repoRoot
try {
  if (-not (Get-Command $GoExecutable -ErrorAction SilentlyContinue)) {
    $GoExecutable = Join-Path $repoRoot ".data/tools/go/bin/go.exe"
    if (-not (Test-Path -LiteralPath $GoExecutable)) { throw "找不到 Go 工具链" }
  }
  New-Item -ItemType Directory -Force -Path $contextDir | Out-Null
  if ($CertificatesFile) {
    Copy-Item -LiteralPath $CertificatesFile -Destination (Join-Path $contextDir "ca-certificates.crt")
  } elseif ($CertificatesContainer) {
    docker cp "${CertificatesContainer}:/etc/ssl/certs/ca-certificates.crt" (Join-Path $contextDir "ca-certificates.crt")
    if ($LASTEXITCODE -ne 0) { throw "从原容器复制 CA 证书失败" }
  } else {
    throw "请通过 CertificatesFile 或 CertificatesContainer 指定可信 CA 证书来源"
  }
  pnpm build
  if ($LASTEXITCODE -ne 0) { throw "前端构建失败" }
  $env:GOOS = "linux"
  $env:GOARCH = $Architecture
  $env:CGO_ENABLED = "0"
  foreach ($program in @("markvault", "markvault-migrate")) {
    & $GoExecutable build -trimpath '-ldflags=-s -w' -o (Join-Path $contextDir $program) "./cmd/$program"
    if ($LASTEXITCODE -ne 0) { throw "$program Linux 程序构建失败" }
  }
  Copy-Item -LiteralPath (Join-Path $repoRoot "dist") -Destination (Join-Path $contextDir "dist") -Recurse
  New-Item -ItemType Directory -Path (Join-Path $contextDir "empty") | Out-Null
  New-Item -ItemType File -Path (Join-Path $contextDir "empty/.keep") | Out-Null
  docker build --platform "linux/$Architecture" -f docker/Dockerfile.go-prebuilt -t $Image $contextDir
  if ($LASTEXITCODE -ne 0) { throw "Docker 镜像构建失败" }
  Write-Host "镜像构建完成，构建缓存位于 $contextDir"
} finally {
  $env:GOOS = $savedGoOS
  $env:GOARCH = $savedGoArch
  $env:CGO_ENABLED = $savedCGO
  Pop-Location
}
