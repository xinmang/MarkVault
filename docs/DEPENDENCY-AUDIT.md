# 依赖与漏洞审计记录

检查日期：2026-10-22。对象是当前 Go 架构的依赖树：Go 侧由 `go.mod` / `go.sum` 决定，前端由 `pnpm-lock.yaml` 决定。以下只记录本轮实际执行的结果，不复用旧审计统计；历史记录可从 Git 历史读取。

## Go 侧

### 结果

| 项目 | 结果 |
| --- | --- |
| 工具链 | `go.mod` 声明 Go 1.27.4 |
| `govulncheck v1.9.0`（Windows，符号扫描） | **0 条 finding** |
| `govulncheck v1.9.0`（Linux，符号扫描） | **0 条 finding** |
| 第三方 Go 依赖告警 | 无 |
| 直接依赖 | `go-chi/chi/v5`、`golang-jwt/jwt/v5`、`modernc.org/sqlite`（纯 Go 驱动） |

本轮同时通过：Windows `go build ./...`、`go vet ./...`、`go test ./...`，以及 `linux/amd64`、`linux/arm64` 交叉编译。

### 标准库告警与工具链升级

在 Go 1.27.0 上，`govulncheck` 匹配到 14 条标准库告警，其中 12 条有符号可达路径；第三方 Go 依赖没有告警。处理方式是升级工具链到 1.27.3，没有为了消除告警去盲目升级或替换第三方包。代表性记录（可在 `pkg.go.dev/vuln/` 下查询）：

- [`GO-2026-6809`](https://pkg.go.dev/vuln/GO-2026-6809)
- [`GO-2026-6604`](https://pkg.go.dev/vuln/GO-2026-6604)
- [`GO-2026-6609`](https://pkg.go.dev/vuln/GO-2026-6609)

升级后重扫为 0 条 finding。CI 的 Go 检查作业固定 `govulncheck@v1.9.0`，使用 `go-version-file: go.mod`，因此工具链版本随 `go.mod` 变化。

## 前端与 npm 依赖

使用 npm 官方源审计（本机镜像源不一定支持审计接口）：

```bash
pnpm audit --json --registry=https://registry.npmjs.org
pnpm audit --prod --json --registry=https://registry.npmjs.org
```

### 结果

| 范围 | Vitest 4.1.11 | 升级到 4.1.12 后 |
| --- | --- | --- |
| 全量依赖 | 2 条中危 | **0 条** |
| 生产依赖 | 0 条 | **0 条** |

两条中危都来自开发测试链的 `@vitest/mocker` 4.1.11：

- [GHSA-qxg6-89mg-rqv8](https://github.com/advisories/GHSA-qxg6-89mg-rqv8)
- [GHSA-xp26-3454-mjgp](https://github.com/advisories/GHSA-xp26-3454-mjgp)

把 `vitest` 升到 `4.1.12` 后重新审计，全量和生产均为 0 条。`yaml@<2.8.3 → ^2.8.3` 的定向 override 继续保留在 `package.json` 中。CI 在安装依赖后执行 `pnpm audit --prod --audit-level high`。

## 已移除的在线后端依赖

Wrangler、workerd、Miniflare、workers-types 以及 `functions/` 在线后端已从仓库删除，因此不再进入依赖树、审计结果和 CI 流程。留下的 `migrations/`、`cmd/markvault-migrate` 与 `internal/legacy` 只提供离线旧数据迁移能力，不引入额外运行时依赖。

## 应用层安全修复（本轮）

- 私有书签封面与图标改为短期签名 URL，并逐次校验所有者与分享权限。
- 快照图片签名绑定快照 ID、版本与到期时间，不为不同快照复用签名。
- 密码哈希成本从 100000 次 PBKDF2-SHA256 提升到 600000 次，旧哈希在登录成功后自动升级。
- 访问令牌与刷新令牌默认有效期改为 15m / 30d，前端实现刷新轮换并修复会话并发竞态。
- 增加通用防点击劫持响应头，外链跳转隔离 `opener`。

## 检查边界

- 零 finding / 零告警表示检查当日工具与审计接口未报告当前依赖树的已知问题，不代表完整安全审计。
- 本轮未扫描容器镜像内的操作系统软件包，也未对独立扩展仓库重新统计。
- 本机 Docker daemon 不可用，本轮没有实际构建或运行新镜像；镜像构建与两架构冒烟以 CI 结果为准。部署相关说明见 [发布流程](PUBLISHING.md)。
