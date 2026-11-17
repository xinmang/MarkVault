# Go 后端部署与旧版本数据迁移

MarkVault 只有一个后端：Go 程序同时提供 API、SQLite、本地对象存储和前端静态资源。Api 端口、静态资源和数据目录都由同一个进程管理，不需要 Wrangler、workerd 或其他运行时。

| 项目           | 默认值                                         |
| -------------- | ---------------------------------------------- |
| Compose 项目   | `markvault`（统一 `docker-compose.yml`，服务 `app`） |
| 访问地址       | `http://localhost:8787`                        |
| 宿主端口       | `APP_PORT`，默认 `8787`                        |
| 绑定地址       | `APP_BIND`，默认 `127.0.0.1`                   |
| 镜像           | `MARKVAULT_IMAGE`，默认 `ghcr.io/xinmang/markvault:latest` |
| 数据目录       | `MARKVAULT_DATA_DIR`，默认 `./data/go`（容器内 `/data`） |
| 容器用户       | UID / GID `1000:1000`                          |

生产部署建议固定明确版本标签或镜像摘要，`latest` 会随构建更新。

## 迁移工具与历史迁移文件不是第二后端

`cmd/markvault-migrate`、`internal/legacy` 以及 `migrations/` 中的历史 SQL 迁移文件只提供**离线旧数据迁移能力**：前者在服务不运行时把旧实例的 Miniflare D1 / R2 目录转换为 Go 数据目录，后者保留旧库升级所需的历史迁移步骤。它们不会被当作在线 API 运行，也不提供额外端口。

迁移工具会：

- 读取旧实例的 D1 与 R2 目录，转换数据库和对象，保留用户、密码哈希、API Key、AI 配置和实例密钥。
- 使用包含 WAL 内容的一致性数据库备份；对象逐一校验长度与 R2 ETag。
- 建立快照图片引用索引，并检查数据库完整性与外键。
- 要求源目录内只有一个 D1 数据库和一个 R2 元数据库；遇到 R2 分段上传对象会中止迁移。
- 要求目标目录尚不存在；失败时清理临时目录，不覆盖已有目标。

## 从旧版本迁移数据

**旧版 `data/database`、`data/storage`、`data/config` 不能直接挂载到新版 `/data`。** 必须先停止旧实例写入，再运行迁移工具。

准备 Go 工具链（按 `go.mod`，当前 1.27.4）。以下命令在仓库根目录通过 PowerShell 执行；使用工作区下载的工具链时，把 `go` 替换为 `./.data/tools/go/bin/go.exe`。

```powershell
# 迁移期间必须停止旧实例写入，保证数据库与对象文件对应。
docker pause <旧实例容器名>
if ($LASTEXITCODE -ne 0) { throw "无法暂停旧版容器" }
try {
    go run ./cmd/markvault-migrate -source ./data -destination ./data/go
    if ($LASTEXITCODE -ne 0) { throw "数据迁移失败" }
} finally {
    docker unpause <旧实例容器名>
    if ($LASTEXITCODE -ne 0) { Write-Warning "请检查旧版容器并恢复运行" }
}
```

把 `<旧实例容器名>` 替换为实际容器名（可用 `docker compose ps` 查询），不要在同一脚本里硬编码个人环境。如果旧实例已经停止，可以直接运行迁移命令。

迁移完成后检查 `data/go/migration-report.json`，确认表行数、对象数量和快照图片数量符合预期。**保留源数据备份以及原密钥**，不要删除源目录。

```text
data/go/
├── config/runtime.env          # 原实例 JWT 与加密密钥
├── database/markvault.sqlite   # Go 版业务数据库
├── objects/                    # 快照、快照图片及封面
└── migration-report.json       # 迁移统计
```

迁移后新旧数据各自独立，不会自动同步。

## 从旧版 Go Compose 文件迁移

此前用独立 Compose 文件（已删除）运行过 Go 版本的用户：先停止原 `markvault-go` 容器，保留其 `data/go` 目录，然后把旧变量映射到统一配置：

| 旧变量                    | 新变量                 |
| ------------------------- | ---------------------- |
| `MARKVAULT_GO_IMAGE`      | `MARKVAULT_IMAGE`      |
| `GO_APP_PORT`             | `APP_PORT`             |
| `MARKVAULT_GO_DATA_DIR`   | `MARKVAULT_DATA_DIR`   |

然后使用统一的 `docker compose up -d --no-build --wait`（或 `pull` 后启动）。迁移前先停止写入并备份，检查数据目录归属与端口占用，不要运行未经检查的清理或覆盖命令。

## 数据目录权限

容器以 UID/GID `1000:1000` 运行并启用只读根文件系统。Windows 上由宿主机迁移产生的绑定目录可能在容器内显示为 root 所有，导致 SQLite 初始化报 `operation not permitted`。

### Linux 宿主机

新建的空目录必须在第一次 `docker compose up` 之前创建并交给容器用户，否则首启会因无法写入 `/data` 失败：

```bash
mkdir -p data/go
sudo chown 1000:1000 data/go
```

在 Go 容器停止时执行，属主与权限需与备份一致。

### Windows：`scripts/prepare-go-data.ps1`

脚本只接受完整的迁移副本（含 `migration-report.json`、`database/markvault.sqlite`、`config/runtime.env`、`objects/`），通过普通 Go 运行镜像内的 `/bin/sh` 调整属主与权限（目录 `0700`、文件 `0600`）；数据目录只作为 `/go-data` 一处挂载传入，不拼接进 shell 命令。脚本保留路径检查、在用挂载重叠检查（相同、祖先或后代都拒绝）以及符号链接与特殊文件检查。

读取迁移报告和调用 Docker 之前，脚本会做这些检查：

- **目标、祖先、后代都检查重解析点**：从目标目录自身逐级检查到盘根，拒绝符号链接、junction 或映射目录；后代用不跟随链接的显式目录遍历，遇到重解析点立即拒绝，不会先递归进入链接；目录无法枚举或类型无法判断时直接失败退出，不修改任何权限。
- **Docker Desktop 挂载路径统一比较**：容器检查报告里的绑定挂载源会先标准化成同一 Windows 物理路径再比对，包括原生盘符路径以及 Docker Desktop 常见的 `/run/desktop/mnt/host/c/...`、`/host_mnt/c/...`、`/mnt/c/...` 形式。目标、祖先、后代都拒绝，兄弟目录允许。无法可靠识别的 Windows 绑定挂载源不会被当成“不重叠”，而是直接失败并提示先停止相关容器。
- **挂载参数安全**：目标路径含逗号、双引号或控制字符时拒绝执行（这些字符会破坏 `docker --mount` 的字段分隔）；镜像名不得以连字符开头或含控制字符。

脚本仍只挂载目标目录这一处，使用 `--network none`、`--pull=never` 和参数数组调用，不产生可 eval 的字符串，临时容器不会接触其他宿主目录。**脚本只识别上述明确的路径形式，不能识别所有映射驱动器或第三方文件系统重定向**；这类环境请先把数据目录放到本地固定盘符路径再运行。

```powershell
docker compose stop app
./scripts/prepare-go-data.ps1
```

如果 Go 容器尚未创建，可直接执行。使用其他目标目录时传入 `-DataDirectory C:/path/to/go-copy`；镜像默认为 `ghcr.io/xinmang/markvault:latest`，需要其他镜像时用 `-Image` 指定。脚本拒绝仓库根目录、旧版 `data` 目录、磁盘根目录、目标及其祖先路径上的重解析点（含重解析点盘根）、与运行中容器绑定挂载重叠的副本（含 Docker Desktop 的 `/run/desktop/mnt/host/...` 等形式），以及含符号链接、junction 或特殊文件的目录。

镜像必须已存在于本机（脚本使用 `--pull=never`）。`scratch` 形式的预构建镜像没有 shell，不适用这个权限脚本；请改用下面的普通 Go 运行镜像方案。

## 拉取 GitHub 自动构建的镜像

推送 `main` 分支、推送 `v*` 标签或手动运行 GitHub Actions 工作流，都会触发镜像发布。工作流先完成前端与 Go 检查，再构建 `linux/amd64`、`linux/arm64` 镜像并验证启动、健康接口和首页。

- 跟随最新构建：`ghcr.io/xinmang/markvault:latest`。
- 固定版本：`ghcr.io/xinmang/markvault:1.2.3`（也可用 `1.2`、`1`），或使用摘要。
- 固定某次提交：`ghcr.io/xinmang/markvault:sha-<提交前七位>`。

版本号来自 `package.json` 的 `version`，版本设置页由构建时注入，提升版本号不代表已经发布。普通 `main` 推送时，若同名镜像版本已存在，工作流会失败并提示先提升 `version`；推送与版本一致的 `v*` 标签或手动运行工作流并勾选 `republish=true` 时允许覆盖同一版本号。仓库与镜像包可见性需分别设置；私有镜像需先用具有 `read:packages` 权限的 GitHub 令牌执行 `docker login ghcr.io`。

准备数据目录权限后在仓库根目录运行：

```powershell
docker compose pull app
docker compose up -d --no-build --wait
```

访问 `http://localhost:8787`。新建的绑定目录同样必须允许 UID/GID `1000:1000` 写入。如需直接试用而不绑定宿主机目录，可使用命名卷（与 Compose 二选一，避免端口或容器名冲突）：

```powershell
docker run -d --name markvault-trial -p 8787:8787 -v markvault-trial-data:/data ghcr.io/xinmang/markvault:1.2.3
```

## 从源码构建镜像

联网环境使用根目录 `Dockerfile` 的多阶段构建：

```powershell
$env:MARKVAULT_IMAGE = "markvault:local"
docker compose up -d --build --wait
```

`Dockerfile` 使用 `NODE_IMAGE=node:24-bookworm-slim` 构建前端，`GO_IMAGE=golang:1.27.4-bookworm` 编译 Go 程序与迁移工具，`RUNTIME_IMAGE=debian:bookworm-slim` 作为运行镜像；运行镜像只含 Go 可执行程序、静态资源和 CA 证书，以非 root 用户启动并使用程序内置健康检查。不要用本地构建错误覆盖生产镜像标签。

### 离线预构建（保留方案）

Docker Hub 无法访问时，可用本机 Go 与 pnpm 构建 Linux 静态程序和前端，再打包为 `scratch` 镜像。方案保留在 `scripts/build-go-docker.ps1` 和 `docker/Dockerfile.go-prebuilt`，**不依赖任何旧 Node 后端镜像**。

```powershell
pnpm install --frozen-lockfile
./scripts/build-go-docker.ps1 -CertificatesFile C:/path/to/ca-certificates.crt
$env:MARKVAULT_IMAGE = "markvault:go"
docker compose up -d --no-build --wait
```

CA 证书需通过 `-CertificatesFile` 或 `-CertificatesContainer` 明确指定（也可用 `docker cp` 从任意含证书的镜像获取）。脚本默认使用 `go`，未找到时尝试 `.data/tools/go/bin/go.exe`，可用 `-GoExecutable` 指定。默认目标 `linux/amd64`，ARM64 主机传 `-Architecture arm64`。构建缓存保存在 `.data/go-image-*`，不含数据库和实例密钥。

`scratch` 镜像没有 shell，因此不能用于 `scripts/prepare-go-data.ps1`；需要脚本调整权限时请改用普通 Debian 运行镜像。

检查状态：

```powershell
docker compose ps
docker compose logs --tail=100 app
Invoke-RestMethod http://localhost:8787/api/v1/health
docker compose restart app
```

健康响应为 `{"data":{"backend":"go","status":"ok"}}`。迁移后使用原账号登录，原有 API Key 继续有效。公网部署请配置 HTTPS、反向代理与访问限制，见 [部署指南](../DEPLOYMENT.md)。

## 配置与本地运行

Compose 会读取仓库 `.env`。主要变量：

| 变量                           | 作用                                                     |
| ------------------------------ | -------------------------------------------------------- |
| `APP_PORT`                     | 宿主端口，默认 `8787`                                    |
| `APP_BIND`                     | 宿主绑定地址，默认 `127.0.0.1`                           |
| `MARKVAULT_IMAGE`              | 镜像标签，默认 `ghcr.io/xinmang/markvault:latest`        |
| `MARKVAULT_DATA_DIR`           | 宿主数据目录，默认 `./data/go`                           |
| `ALLOW_REGISTRATION`           | 默认 `true` 允许设置页控制；`false` 强制关闭注册             |
| `JWT_ACCESS_TOKEN_EXPIRES_IN`  | 访问令牌有效期，默认 `15m`                               |
| `JWT_REFRESH_TOKEN_EXPIRES_IN` | 刷新令牌有效期，默认 `30d`                               |
| `STORAGE_MAX_TOTAL_BYTES`      | 存储配额字节数，默认 `7516192768`，`0` 不限制            |
| `CORS_ALLOWED_ORIGINS`         | 允许的完整来源，以逗号分隔，默认空                       |
| `AI_ALLOW_PRIVATE_ENDPOINTS`   | 是否允许 AI 请求私网端点，默认 `false`                   |
| `AI_CHAT_MAX_TOOL_ROUNDS`      | 单次聊天工具轮数，默认 `6`，范围 `1–20`                  |

全站品牌设置（网站名称、描述、Logo、favicon）保存在 SQLite 的单例表 `site_settings` 中，对所有账号和匿名页面生效，仅管理员可以修改。首个成功注册的账号自动成为管理员，后续账号均为普通用户，不再使用 `MARKVAULT_ADMIN_USER_ID`。旧实例升级时保留已有管理员；没有管理员则由最早注册的账号管理站点。初始化只执行一次，删除账号或撤销角色不会触发重新授予权限。

`JWT_SECRET`、`ENCRYPTION_KEY` 默认从数据目录的 `config/runtime.env` 读取或自动生成；环境变量中的同名值优先。迁移时必须与原实例保持一致，否则原有令牌或加密配置会失效。完整配置见 `internal/config/config.go`。

直接运行 Go 程序时不会读取仓库 `.env`，需要显式导出环境变量。数据目录默认 `.data/go`，前端目录 `MARKVAULT_WEB_DIR` 默认 `dist`，监听地址 `MARKVAULT_ADDR` 默认 `:8787`（`PORT` 默认 `8787`）：

```powershell
pnpm build      # 先生成 dist/；pnpm start 与 pnpm dev:api 都只执行 go run，不会构建前端
$env:MARKVAULT_DATA_DIR = (Join-Path $PWD ".data/go")
pnpm start
```

同一数据目录同时只能运行一个服务进程；本地启动前先停止使用该目录的 Docker 服务。

## 备份与已知限制

备份前停止服务，整体复制数据目录，然后恢复服务。备份必须同时包含 `database/markvault.sqlite`（运行期间还有 `-wal`、`-shm`）、`objects/` 和 `config/runtime.env`；不能只复制主数据库文件。JSON 导出只包含业务数据，不含快照文件和完整恢复所需内容。

```powershell
docker compose stop app
# 将完整的数据目录复制到独立位置
docker compose start app
```

上传快照时先检查存储配额，再按保留策略淘汰旧版本。接近配额上限时可能需要先清理旧快照或提高 `STORAGE_MAX_TOTAL_BYTES`。

私有书签图片签名有效期为 1 小时，快照与快照图片为 24 小时；这些链接是持有者可访问的临时凭据，不应写入日志或公开传播。
