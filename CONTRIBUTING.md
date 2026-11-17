# 参与 MarkVault

欢迎提交问题、文档改进、翻译和代码修改。MarkVault 基于 TMarks 改造，贡献应与仓库 [LICENSE](LICENSE) 的 CC BY-NC 4.0 条款兼容，并保留相关来源署名。

## 开发环境

- Go 工具链按 `go.mod`（当前 1.27.4），用于 API、SQLite 与静态资源服务。
- Node.js 22+；`.nvmrc` 和 Docker 镜像使用 24。Node 仅用于前端构建与开发。
- pnpm 9.7.1，与 `packageManager` 字段保持一致。
- Git；本地开发不需要 Cloudflare 账号，也不需要 Wrangler。

```bash
pnpm install --frozen-lockfile
pnpm build         # 构建前端到 dist/
pnpm db:migrate
pnpm start
```

`pnpm start` 与 `pnpm dev:api` 都用 `go run ./cmd/markvault` 启动包含 API 的 Go 服务（`http://localhost:8787`），两者**都不会构建前端**，需要前端产物时先执行 `pnpm build`。首次启动会自动生成实例密钥并应用迁移，不需要单独的初始化脚本。`scripts/go.mjs` 会读取仓库 `.env`（已有进程环境优先）并查找 PATH 中的 `go`；Windows 找不到时回退到 `.data/tools/go/bin/go.exe`。附加参数直接交给 go：`migrate`、`run` 的附加参数传给程序，`test`、`build` 的附加参数是 go 标志（放在包路径之前，例如 `node scripts/go.mjs test -race`）。

另开终端运行 `pnpm dev`，访问 `http://localhost:5173` 使用前端热更新；Vite 把 `/api` 代理到 `8787`。`pnpm dev` 与 `pnpm preview` 单独运行都不会启动后端。

数据目录：原生运行默认 `.data/go`，Compose 默认 `./data/go`，可用 `MARKVAULT_DATA_DIR` 覆盖。`.env` 与 `.data/` 均不提交到 Git。不要给客户端可见的 `VITE_*` 变量设置密钥。

纯 Go 二进制不会自动读取 `.env`，直接 `go run ./cmd/markvault` 时必须自行导出环境变量。

## 修改约定

- 新注释与项目文档使用中文；用户可见文案同步维护 `zh-CN` 和 `en` 语言资源。
- 共享数据契约和权限放在 `shared/`，避免前后端各自定义不一致的结构。
- 数据库改动新增按顺序命名的迁移，不修改已经发布的迁移文件；保留 `migrations/` 中的历史迁移，`cmd/markvault-migrate` 与 `internal/legacy` 是离线旧数据迁移能力，不要把它们当作第二个后端改造成在线服务。
- 安全相关改动（签名 URL、分享权限、CORS、限流、快照沙箱）需同时补充回归测试。
- 修改 Agent API 时同步检查 `public/openapi-agent.json`、`public/llms.txt` 和 `public/markvault/references/api.md`。
- 扩展源码与安装包在 [markvault-extension](https://github.com/xinmang/markvault-extension) 独立构建；本仓库通过 `src/lib/extension.ts` 引用 GitHub Release，不提交扩展 ZIP。
- 不提交 `.env*` 的实际配置、密钥、数据库、备份或个人书签。
- 仓库只保留 `main` 分支。功能开发用 fork 或本地临时分支，不要长期保留集成分支。

## 验证

前端：

```bash
pnpm type-check
pnpm lint
pnpm test
pnpm build
```

Go：

```bash
gofmt -l cmd internal
go build ./...
go vet ./...
go test ./...
go install golang.org/x/vuln/cmd/govulncheck@v1.9.0   # CI 固定此版本
govulncheck ./...
```

`pnpm test:api` 等价于 `go test ./...`，`pnpm build:api` 会把 `markvault` 与 `markvault-migrate` 编译到 `build/`。`type-check` 覆盖 `src/` 与 `shared/`，不能替代 Go 侧的编译与静态检查。

## 版本号与发布

- 每次提交都要提升 `package.json` 的 `version`，格式为 `x.y.z` 语义化版本，不带前导零：从 `0.1.0` 起每次提交把末段加 1（`0.1.0`、`0.1.1`、`0.1.2`……），且只增不减；有重大功能或不兼容变更时再提升次版本号或主版本号。提升版本号不等于该版本已发布，发布以镜像工作流成功为准。
- Docker 镜像由 [`.github/workflows/docker-image.yml`](.github/workflows/docker-image.yml) 发布。`main` 推送、`v*` 标签推送和手动触发都会构建 `linux/amd64`、`linux/arm64` 镜像，并按 `version` 生成 `x.y.z`、`x.y`、`x`、`latest` 和 `sha-<提交>` 标签。
- 普通 `main` 推送默认拒绝覆盖：工作流检测到同名镜像版本已存在时直接失败，因此每次更新要先提升 `version`。推送与版本一致的 `v*` 标签，或手动运行工作流并勾选 `republish`，允许重新发布同一版本号。
- 发布 `v*` 标签时，标签名必须与 `package.json` 的 `version` 一致，例如 `v0.1.1`。

## 提交 Issue 与 Pull Request

问题请包含复现步骤、预期与实际行为、运行方式（Docker 或原生 Go）、版本/提交号及已脱敏日志。不要在公开 Issue 中提交完整 API Key、用户数据、签名 URL 或安全漏洞利用细节；安全问题见 [SECURITY.md](SECURITY.md)。

PR 说明具体问题、修改后的行为和验证结果。涉及数据库、配置默认值或部署步骤时同步更新 README、DEPLOYMENT.md 及 docs/ 下相关文档。GitHub Actions 会执行前端类型检查、规范检查、测试与构建，以及 Go 的格式化、编译、静态检查、测试与 `govulncheck` 漏洞扫描。
