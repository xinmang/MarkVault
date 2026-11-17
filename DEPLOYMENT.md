# MarkVault 部署指南

MarkVault 的 Go 程序同时提供 API、SQLite、本地对象存储和前端静态资源。一个容器即可运行，每次启动会检查并应用尚未执行的数据库迁移。

统一的 `docker-compose.yml` 定义 Compose 项目 `markvault` 和服务 `app`；容器以 UID/GID `1000:1000` 运行，启用只读根文件系统、`cap_drop: ALL` 与 `no-new-privileges`。

## 准备与启动

准备 Docker Engine 24+、Docker Compose v2，以及保存仓库和数据的持久磁盘。建议至少预留 1 GB 内存；实际需求取决于数据量、快照大小及是否在本机构建。

```bash
git clone https://github.com/xinmang/MarkVault.git
cd MarkVault
cp .env.example .env      # PowerShell 用 Copy-Item .env.example .env
mkdir -p data/go && sudo chown 1000:1000 data/go   # 仅 Linux 新建空目录时，必须在首次启动前完成
docker compose pull app
docker compose up -d --no-build --wait
```

访问 `http://localhost:8787` 注册账号，并确认接口正常：

```bash
docker compose ps
docker compose logs --tail=100 app
curl http://localhost:8787/api/v1/health
```

健康接口返回 `{"data":{"backend":"go","status":"ok"}}` 表示进程能响应请求并访问数据库，不代表已验证外部 AI 服务。首次部署还应实际登录并创建一条书签。

### 数据目录权限

`data` 绑定默认为 `./data/go`（由 `MARKVAULT_DATA_DIR` 决定）。Linux 宿主上新建的空目录必须在第一次 `docker compose up` 之前交给容器用户，否则首个容器会因无法写入 `/data` 而启动失败：

```bash
mkdir -p data/go
sudo chown 1000:1000 data/go
```

目录属主不一致时，SQLite 初始化或写入快照对象会失败。Windows 与 Docker Desktop 的绑定挂载由桌面端映射权限，通常无需 chown，但请按实际平台先验证注册、上传快照和重启后数据持久化。恢复已有备份时，也要恢复 `1000:1000` 属主。

容器只读根文件系统，运行期所有写入都发生在 `/data`。不要启动多个副本共享同一数据目录。

## 配置

配置保存在仓库根目录 `.env`，由 Compose 传入容器。纯 Go 二进制不自动读取 `.env`，原生运行需自行导出环境变量。

| 变量                           | 默认值                          | 说明                                                                 |
| ------------------------------ | ------------------------------- | -------------------------------------------------------------------- |
| `APP_PORT`                     | `8787`                          | 宿主机发布端口                                                       |
| `APP_BIND`                     | `127.0.0.1`                     | 宿主机绑定地址；需要直接暴露公网时才改为 `0.0.0.0`                   |
| `MARKVAULT_IMAGE`              | `ghcr.io/xinmang/markvault:latest` | 镜像名称；生产建议固定明确版本标签或摘要                          |
| `MARKVAULT_DATA_DIR`           | `./data/go`                     | 宿主机可写数据目录，挂载到容器 `/data`                               |
| `NODE_IMAGE`                   | `node:24-bookworm-slim`         | 仅源码构建前端阶段使用                                               |
| `GO_IMAGE`                     | `golang:1.27.4-bookworm`        | 仅源码构建 Go 阶段使用                                               |
| `RUNTIME_IMAGE`                | `debian:bookworm-slim`          | 运行镜像基础镜像                                                     |
| `ALLOW_REGISTRATION`           | `true`                          | 允许设置页控制注册；`false` 强制关闭，首次注册后自动关闭界面开关       |
| `JWT_ACCESS_TOKEN_EXPIRES_IN`  | `15m`                           | 访问令牌有效期                                                       |
| `JWT_REFRESH_TOKEN_EXPIRES_IN` | `30d`                           | 刷新令牌有效期                                                       |
| `STORAGE_MAX_TOTAL_BYTES`      | `7516192768`                    | 快照与图片的实例级总配额，约 7 GiB；`0` 不限制，不含数据库大小       |
| `CORS_ALLOWED_ORIGINS`         | 空                              | 精确来源白名单，多个完整来源用逗号分隔；扩展须显式配置               |
| `JWT_SECRET`                   | 空                              | 至少 48 个字符；留空时由服务生成并保存到数据目录                     |
| `ENCRYPTION_KEY`               | 空                              | 至少 48 个字符；用于加密第三方 AI Key，留空时自动生成                |
| `AI_ALLOW_PRIVATE_ENDPOINTS`   | `false`                         | 是否允许自定义 AI 服务访问内网地址；仅在信任实例用户时需要           |
| `AI_CHAT_MAX_TOOL_ROUNDS`      | `6`                             | 单次聊天最多执行的只读工具轮数，范围 `1–20`                          |

修改 `.env` 后执行 `docker compose up -d` 让 Compose 重建容器。`NODE_IMAGE`、`GO_IMAGE`、`RUNTIME_IMAGE` 仅在源码构建（`--build`）时生效。

密钥首次写入 `<数据目录>/config/runtime.env`，后续启动复用；`.env` 中非空的密钥会覆盖保存值。不要随意更换 `ENCRYPTION_KEY`，否则已保存的 AI Key 无法解密。

令牌默认值调整说明：旧版本默认签发了一年有效期令牌。升级后默认值变为 15m / 30d，但**已签发的长效令牌不会因此立即失效**。如需统一收紧，可更换 `JWT_SECRET` 撤销全部会话，或提示用户重新登录。

首个成功注册的账号自动成为管理员（`role='admin'`），后续账号均为普通用户。全站品牌设置与插件管理统一使用管理员角色校验；普通用户可以查看品牌信息，不能修改。关闭注册只影响新用户，不会禁用已有账号。

### 初始化管理员

1. 部署完成后，在对外开放注册前创建首个账号，该账号自动成为管理员。
2. 登录后进入“设置 → 网站设置”，即可编辑网站名称、描述、Logo 与 favicon；其他账号看到只读提示。
3. 首个账号创建后自动关闭注册。管理员可在「设置 → 账户与语言 → 用户注册」即时开关；若部署者设置 `ALLOW_REGISTRATION=false`，界面无法重新开放注册。

迁移 `0131_initial_admin.sql` 为旧实例保留已有管理员；若没有管理员，则按注册时间和插入顺序将最早账号设为管理员。初始化标记与注册事务绑定，并发注册只会产生一个初始管理员；删除账号或撤销角色后不会自动重新分配。旧的 `MARKVAULT_ADMIN_USER_ID` 环境变量已不再使用，可从本地配置中移除。书签、标签页组等账号数据仍按所有者隔离。

迁移 `0132_registration_passkeys.sql` 为已有账号的实例默认关闭注册，新增通行密钥插件所需的认证表。Passkey 要求 HTTPS 或 localhost，反向代理保留 Host；详见 [注册控制与通行密钥](docs/passkeys-and-registration.md)。

## 使用预构建镜像与源码构建

默认使用 GHCR 的预构建镜像：

```bash
docker compose pull app
docker compose up -d --no-build --wait
```

工作流在 `main` 推送、`v*` 标签推送及手动触发时构建 `linux/amd64` 和 `linux/arm64` 镜像。镜像标签由 `package.json` 的 `version` 生成：`1.2.3` 版本发布 `1.2.3`、`1.2`、`1` 并更新 `latest`，另有 `sha-<提交>` 标签。普通 `main` 推送时若同名版本已存在，工作流会失败并要求先提升 `version`；推送与版本一致的 `v*` 标签或手动触发时勾选 `republish=true` 允许覆盖同一版本号。生产部署建议固定版本标签或镜像摘要，`latest` 会随构建更新。仓库与镜像包的可见性需要分别设置。

本地构建镜像（多阶段：Node 构建前端 + Go 编译 → 仅含二进制、静态资源和 CA 证书的运行镜像）：

```bash
MARKVAULT_IMAGE=markvault:local docker compose up -d --build --wait
```

**不要用本地构建结果覆盖生产镜像标签**，始终通过 `MARKVAULT_IMAGE` 指定本地标签。

## 持久化目录

```text
<数据目录>/
├── database/markvault.sqlite   SQLite 数据库（运行时有 -wal / -shm）
├── objects/                   快照、快照图片、封面图和图标
├── config/runtime.env         JWT 与第三方密钥加密配置
└── migration-report.json      仅使用迁移工具时生成
```

原生运行默认使用 `.data/go`；Compose 默认 `./data/go`；设置 `MARKVAULT_DATA_DIR` 后以其值为准。这些文件绑定到宿主机，容器删除或镜像更新不会替代正常备份。SQLite、快照和图片不做磁盘加密；备份文件包含账号数据和实例密钥。

## 备份与恢复

为保持数据库与对象文件一致，停止应用后备份。以下命令适用于 Linux/macOS shell：

```bash
mkdir -p backups
docker compose stop app
tar -czf "backups/markvault-data-$(date +%Y%m%d-%H%M%S).tar.gz" -C data go
docker compose start app
```

备份失败时也应重新启动服务。备份必须包含 `database/`（含 WAL 配套文件）、`objects/` 和 `config/runtime.env`。`backups/` 已排除在 Git 和 Docker 构建上下文之外；请另存到其他磁盘或主机并限制访问。

恢复流程：

1. 停止应用，单独保存当前完整数据目录，以便回退。
2. 在临时目录解压备份，用其中完整的数据目录替换实例数据目录。
3. 恢复 `1000:1000` 属主与目录权限；检查 `.env` 中非空的密钥是否与备份一致（使用自动生成密钥时这两项应保持为空）。
4. 启动应用，验证登录、书签、快照及已配置的 AI 服务。

“设置 → 数据”的 JSON 只导出业务数据，不含快照文件、图片对象和密钥，不能替代以上备份，也不足以完成完整实例恢复。

## 更新与回退

先完成完整备份。镜像部署：

```bash
docker compose pull app
docker compose up -d --no-build --wait
```

源码构建部署：

```bash
git pull --ff-only
MARKVAULT_IMAGE=markvault:local docker compose up -d --build --wait
```

更新后检查日志和登录功能。数据库迁移不提供自动降级；回退时应同时恢复更新前的数据和对应代码/镜像，不能只切回旧镜像。

海洋彩蛋账号同步由 `0126_ocean_preferences.sql` 自动增加偏好字段，无需新增环境变量。升级默认沿用各浏览器原来的海洋选择；用户可在「设置 → 动效」选择保存到账号。界面动效已精简为一个总开关，旧单项字段继续保留用于兼容。详见 [海洋彩蛋与动效设置](docs/ocean-and-motion-settings.md)。

## HTTPS 与跨域

默认只绑定 `127.0.0.1`，由同机反向代理（Caddy、Nginx、Traefik）转发到 `8787` 并提供 HTTPS。需要容器内代理访问时，按实际网络调整 `APP_BIND`。不要在没有反向代理和访问限制的情况下把端口直接暴露到公网。

跨域客户端填写完整来源，不带路径和尾部斜杠：

```dotenv
CORS_ALLOWED_ORIGINS=https://client.example.com,chrome-extension://你的扩展ID
```

白名单默认为空，不支持 `*` 通配。CORS 只决定浏览器能否读取跨域响应，不能替代登录、API Key 或网络访问控制。

服务端限流默认按 TCP `RemoteAddr` 计算，**不信任 `X-Forwarded-For`、`CF-Connecting-IP`** 等请求头。经过反向代理后，所有客户端会共享代理地址而共用限流额度（一个人连续输错密码就可能让所有人暂时无法登录）。此时把代理地址填入 `MARKVAULT_TRUSTED_PROXIES`（逗号分隔的 IP 或 CIDR，例如 `127.0.0.1,172.16.0.0/12`）：只有来自这些地址的请求才读取 `X-Forwarded-For`，并从右向左跳过可信代理取第一个客户端地址，客户端自行伪造的左侧内容不会被采用。请确保代理会追加而不是原样透传该请求头（Nginx 用 `$proxy_add_x_forwarded_for`，Caddy、Traefik 默认如此），且不要填写 `0.0.0.0/0`。IPv6 来源按 /64 网段合并计数。

登录除按来源地址限流外，还按用户名限制失败次数（15 分钟内 20 次），轮换地址撞库同一账号同样会被拦截；不存在的用户名也计数，不会泄漏账号是否存在。导入同一时间只允许一个任务，并限制每个账号每小时 10 次。

AI 服务和远程图片抓取需要出站网络。自定义内网 AI 端点默认关闭。站内隐私和服务条款是通用说明，多用户运营者应根据实际部署补充联系渠道与政策。

## 故障排查

| 现象            | 检查方式                                                                    |
| --------------- | --------------------------------------------------------------------------- |
| 容器反复重启    | `docker compose logs --tail=200 app`；检查目录属主（`1000:1000`）、磁盘空间、密钥长度 |
| 无法写入数据    | Linux 宿主执行 `sudo chown -R 1000:1000 data/go`；确认没有其他进程占用同一目录 |
| 镜像拉取被拒绝  | 确认 GHCR 标签已发布且包可见性为 Public；或改用本地源码构建                  |
| 扩展请求失败    | 核对实例地址、API Key 权限及 `CORS_ALLOWED_ORIGINS` 中的扩展 ID              |
| AI 配置无法解密 | 核对恢复的 `config/runtime.env` 与 `.env` 使用同一 `ENCRYPTION_KEY`          |
| 数据库迁移失败  | 先完整备份，再根据启动日志排查；不要删除数据库目录                          |
| 健康检查未通过  | 首次启动等待迁移完成，再检查日志与 `/api/v1/health`                          |

Docker Hub 无法访问时，可在 `.env` 中改用镜像源，例如 `NODE_IMAGE=mirror.gcr.io/library/node:24-bookworm-slim`、`GO_IMAGE=mirror.gcr.io/library/golang:1.27.4-bookworm`，再重新构建。镜像源可用性取决于网络环境；完全离线时的预构建方案见 [Go 部署与迁移](docs/GO-DEPLOYMENT.md)。

## 插件运行时与备份

主 Dockerfile 内置经 SHA-256 校验的 Deno 2.9.8；原生部署运行 node scripts/install-deno.mjs 并设置 MARKVAULT_DENO_PATH。缺少运行时仅禁用第三方脚本，核心功能正常。插件包及所有用户插件状态保存在 SQLite，完整备份需包含数据库和实例加密密钥。业务 JSON 导出不包含插件密钥。详见 [插件部署说明](docs/plugins.md)。

图床插件为原生实现，不依赖 Deno。首次升级自动应用图片映射迁移；图床文件需在服务商侧独立备份，数据库与实例密钥备份仍必需。自托管私网图床使用 `MARKVAULT_PLUGIN_PRIVATE_TARGETS` 分别允许上传和图片读取的完整 HTTPS 来源。图床文件仍按逻辑大小计入实例配额；详细配置与清理行为见 [图床插件](docs/image-hosting.md)。

S3 / R2 / MinIO 使用 HTTPS API 端点与独立桶名配置；私有桶默认由服务端签名读取。新迁移为私有对象保留加密读取凭据，实例加密密钥必须与数据库一起备份。公开 CDN 模式需填写桶根目录地址，详见图床插件说明。
