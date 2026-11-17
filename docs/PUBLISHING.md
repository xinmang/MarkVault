# 发布流程与公开仓库检查

本文件是维护者发布当前 Go 架构版本的实操清单。仓库配置、分支规则、包可见性和私密安全报告都不能由提交自动修改，必须由维护者手动确认。

## 发布流程

1. 提升 `package.json` 的 `version`（`x.y.z` 语义化版本，不带前导零：从 `0.1.0` 起每次提交把末段加 1；重大功能或不兼容变更时再提升次版本号或主版本号）。版本设置页显示的版本由 Vite 构建注入，**提升版本号不代表已经发布**。
2. 在干净的工作树执行前端检查：

   ```bash
   pnpm install --frozen-lockfile
   pnpm type-check
   pnpm lint
   pnpm test
   pnpm build
   ```

3. 执行 Go 检查（工具链以 `go.mod` 为准，当前 1.27.4）：

   ```bash
   gofmt -l cmd internal
   go build ./...
   go vet ./...
   go test ./...
   go install golang.org/x/vuln/cmd/govulncheck@v1.9.0
   govulncheck ./...
   ```

4. 使用 npm 官方源重新审计依赖，全量和生产两项都要看：

   ```bash
   pnpm audit --json --registry=https://registry.npmjs.org
   pnpm audit --prod --json --registry=https://registry.npmjs.org
   ```

5. 校验 Compose 文件可解析：

   ```bash
   docker compose --env-file .env.example config --quiet
   ```

6. 提交并推送 `main`，由 [`.github/workflows/docker-image.yml`](../.github/workflows/docker-image.yml) 先用可复用工作流运行代码检查，再用根目录 `Dockerfile` 构建 `linux/amd64`、`linux/arm64` 镜像并逐架构冒烟（启动容器、`/api/v1/health` 返回 `backend=go`、首页包含构建脚本、镜像版本标签与 `version` 一致）。
7. 工作流结束后核对两架构是否都在、`x.y.z` / `x.y` / `x` / `latest` / `sha-<提交>` 标签是否齐全、`/api/v1/health` 与首页是否正常；生产部署应固定明确版本标签，必要时改为固定镜像摘要。
8. 需要发布正式版本时推送与 `package.json` 一致的 `v*` 标签（例如 `v0.1.1`），标签名与版本不一致会被拒绝。

### 版本覆盖规则

- 普通 `main` 推送时，工作流先检查 `<镜像>:<version>` 是否已存在；已存在则失败，要求先提升 `version`。
- 推送 `v*` 标签触发或手动运行工作流并勾选 `republish=true` 时允许覆盖同一版本号，用于重新发布。覆盖会同时移动 `x.y.z`、`x.y`、`x` 与 `latest` 标签，生产固定了摘要的实例不受影响。
- 因此版本号不是绝对不可覆盖，而是“普通 `main` 推送默认拒绝，标签触发和手动重发是例外”。

### 检查边界

本轮（2026-10-22）本机 Docker daemon 不可用，`docker compose --env-file .env.example config --quiet` 只验证了配置可解析，没有实际构建或运行新镜像。镜像构建与双架构冒烟由 CI 完成，发布结论以 CI 结果为准。

### 清理 GHCR 无标签镜像（手动）

每次构建多架构索引和 provenance/SBOM 都会产生额外的无标签清单版本，时间久了会在 GHCR 包中堆积。清理由 [`.github/workflows/cleanup-untagged-images.yml`](../.github/workflows/cleanup-untagged-images.yml) 配合 [`scripts/cleanup-ghcr.mjs`](../scripts/cleanup-ghcr.mjs) 手动执行，**不设定时任务，也不随推送自动运行**。

**两阶段流程：先预览，再按指纹执行**

1. 打开 Actions 的「清理 GHCR 无标签镜像」，用默认参数运行一次：
   - `dry_run` = `true`（默认，只预览）
   - `expected_plan_sha256` = 留空
   - `min_age_hours` = `24`（默认；**不得小于 24**，否则脚本直接失败）

   运行结束后在工作流 Summary 里核对「计划概要」和「候选版本」表，并下载 artifact 中的 `ghcr-cleanup-plan.json` 查看完整清单。此时不会删除任何东西。

2. 确认清单无误后，再次运行同一工作流，参数改为：
   - `dry_run` = `false`
   - `expected_plan_sha256` = 上一步输出的 `plan_sha256`（64 位十六进制，Summary 里会提示）
   - `min_age_hours` = 与上一步**完全一致**的值

   脚本会用同样参数重新读取现场并重算指纹，只有指纹完全一致才会删除；期间若有新的标签或版本变动，指纹变化，**零删除**并报错，需要重新预览。

**删除时会保护什么**

- 只处理当前仓库（`GITHUB_REPOSITORY`）关联的那一个容器包；包必须明确关联到本仓库，否则直接失败，绝不触碰其他包。
- **两类保留根**：所有带任意标签的版本，以及因年龄不足 `min_age_hours` 而保留的近期版本。两者都沿依赖递归保护，避免「保留近期索引却删掉它引用的旧子清单」。
- 引用保护覆盖：多架构索引的 `manifests[]` 子清单；被保留对象的 attestation/referrer（`manifest.subject.digest`、`vnd.docker.reference.digest`）。
- 索引描述符上的 `vnd.docker.reference.digest` 按“该子清单 → 被描述镜像”建立证明依赖，并反向保护被保留镜像的证明文件；索引对子清单的依赖只正向保护，避免误保留旧的无标签父索引。
- 引用图会**递归读取**所有被引用的 manifest，包括不出现在版本列表里的子清单；任何一个读不到都直接中止。
- 只删除**同时满足**以下条件的版本：没有任何标签、不在保留引用图中、且 `created_at` 与 `updated_at` 都早于 `min_age_hours`。
- 任何清单读取失败、分页不完整、`metadata.container.tags` 缺失或结构未知都会 fail closed 直接中止，不会把「没有标签」简单当成可删。

**执行前后的额外保护**

- 每条删除**之前**都会重新读取版本列表，并利用已经完整读取、由摘要固定的引用图核对保留根与当前候选；出现新摘要、根集合变化或目标不再安全时，立即停止后续删除。
- 完整计划指纹在执行开始时核对。随后本次已成功删除的条目会正常改变总指纹，不会被误判为外部变动；删除按引用者先于依赖的顺序进行。
- 同一循环内会重新确认 [`docker-image.yml`](../.github/workflows/docker-image.yml) 没有活动运行：按 `queued`/`in_progress`/`waiting`/`pending`/`requested` 分别带 `status` 过滤查询，并核对 `total_count` 与返回条数一致。
- 只有 HTTP **204** 才算删除成功，其他状态一律不声称成功；每成功一条就把已删除清单落盘，出错立即停止并保留准确结果（网络结果不明的 DELETE 不盲目重试）。
- 结果写入工作区 `ghcr-cleanup-plan.json` 与 `ghcr-cleanup-result.json`；报告区分「近期保留」与「无标签但被引用保护」。写入失败会直接终止，不会静默继续删除。

**权限说明**

工作流只用仓库自身的 `github.token`（`packages: write` + `actions: read`），GitHub 允许已发布该包的仓库通过 Actions 令牌管理该包，因此**不需要**提供个人访问令牌（PAT）。若包未关联到本仓库，脚本会直接失败；此时应先处理包与仓库的关联，而不是把 PAT 写进仓库。

**仅支持 github.com / ghcr.io**

- 脚本把两个地址写死在代码里，只接受精确 HTTPS origin；`GITHUB_API_URL` 若不是 `https://api.github.com` 会直接失败。
- 凭据分流：GitHub bearer 只发 `api.github.com`；换 GHCR pull bearer 的 Basic 凭据只发 `ghcr.io/token?service=ghcr.io&scope=repository:<owner>/<repo>:pull`；pull bearer 只发 `ghcr.io`。

本地预览（可选，仅读取，不会删除）：

```bash
GITHUB_REPOSITORY=xinmang/MarkVault DRY_RUN=true MIN_AGE_HOURS=24 \
  GITHUB_TOKEN="$(gh auth token)" node scripts/cleanup-ghcr.mjs
```

## 2026-10-22 已验证事实

版本以 `package.json` 的 `1.1.0` 为准，发布状态以 CI 结果为准。

**前端**

- `pnpm type-check`、`pnpm lint`、`pnpm test`（75 条用例）、`pnpm build` 全部通过。
- 在浏览器中登录并打开设置页后，页面实际显示“版本 v1.1.0”，与本文件声明的版本一致。

**Go**

- Go 1.27.3 下 Windows `go build`、`go vet`、`go test` 全部通过，`linux/amd64` 与 `linux/arm64` 交叉编译通过。
- 隔离实例真实 HTTP 冒烟通过：健康接口与安全响应头、前端路由回退、注册与登录、默认 15 分钟访问令牌、连续刷新令牌轮换、快照签名与版本篡改防护、退出后令牌撤销。
- `govulncheck v1.9.0` 在 Windows 与 Linux 上做符号扫描均为 **0 条 finding**。
- 数据目录权限脚本的 17 项隔离回归通过，覆盖默认路径、容器挂载重叠、参数注入与目标/祖先/后代 junction；Docker 调用使用测试桩，没有修改真实数据权限。
- 原先 Go 1.27.0 的扫描匹配到 14 条标准库告警（其中 12 条符号可达），没有第三方 Go 依赖告警；处理方式是把工具链升到 1.27.3，而不是盲目升级第三方包。代表记录为 `GO-2026-6809`、`GO-2026-6604`、`GO-2026-6609`，可在 `pkg.go.dev/vuln/` 下查询对应条目。

**依赖与配置**

- 已删除 Wrangler、workerd、Miniflare、workers-types 依赖以及 `functions/` 在线后端；仓库只保留离线迁移工具（`cmd/markvault-migrate`、`internal/legacy`）和历史 SQL 迁移文件，它们不随服务启动。
- npm 官方源首次全量审计为 2 条中危、生产 0 条，均来自 `@vitest/mocker` 4.1.11（`GHSA-qxg6-89mg-rqv8`、`GHSA-xp26-3454-mjgp`）；升级到 Vitest 4.1.12 后重新审计，全量与生产均为 0。详见 [依赖审计记录](DEPENDENCY-AUDIT.md)。
- `docker compose --env-file .env.example config --quiet` 通过。

**应用层安全修复概况**

私有封面/图标改为短期签名、快照图片签名绑定快照 ID/版本与到期时间、PBKDF2 成本升级、访问/刷新令牌默认值改为 15m/30d、前端刷新轮换与会话竞态修复、防点击劫持响应头、外链 `opener` 隔离。零依赖告警不等于完整安全审计。

**未验证范围**

本机 Docker daemon 不可用，本轮没有实际构建或运行新镜像；镜像构建与双架构冒烟以 CI 结果为准。本轮也未扫描镜像内的操作系统软件包。独立扩展仓库（[markvault-extension](https://github.com/xinmang/markvault-extension)）的依赖与构建统计不在本轮重测范围内，不在本仓库文档中复用旧数据。

## 维护者仍需手动完成

- [ ] 确认仓库描述、许可证与上游署名符合实际发布内容；继续保留 CC BY-NC 4.0 非商业限制。
- [ ] 检查准备公开的全部分支、标签和历史是否含私人数据；如发现已泄露的密钥，先撤销或轮换，再处理历史。
- [ ] 将需要公开的仓库设为 Public，并确认 Issues、Actions 等所需功能已启用；包可见性与仓库可见性分开设置，GHCR 包需单独设为 Public，并从无登录凭据的环境验证拉取。
- [ ] 私有包需要先用具有 `read:packages` 权限的 GitHub 令牌执行 `docker login ghcr.io`。
- [ ] 为 `main` 配置合并前检查规则，要求“检查与构建”通过；仅添加 CI 文件不会自动阻止失败提交被合并。
- [ ] 在 GitHub 开启 Private vulnerability reporting（仅需维护者确认，无需改动其他远端设置），为安全报告提供私密入口。
- [ ] 使用空数据目录完成安装、注册、登录、书签、快照及备份恢复验证，并在 CI 成功后从无登录环境验证拉取两个架构的镜像。
- [ ] 每次发布重新运行依赖审计，并补充镜像操作系统层扫描；本轮未执行该项。

## 来源与许可证

2026-10-12 核对发现，上游仓库 README 声称 MIT，但其 [LICENSE 文件](https://github.com/ai-tmarks/tmarks/blob/main/LICENSE) 实际标注 CC BY-NC 4.0，与本仓库现有 LICENSE 一致。本次继续保留现有许可证，不依据上游 README 改成 MIT；发布前仍应确认实际采用版本的许可。

扩展源码位于独立的 markvault-extension 仓库，保留其现有 MIT LICENSE 和 TMarks Team 署名。两个仓库的许可证不应混为一谈，维护者仍需核对具体来源版本和第三方素材许可。

GitHub 官方说明：[包可见性与访问控制](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility)、[开启私密漏洞报告](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository)。
