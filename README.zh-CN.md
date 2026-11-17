# MarkVault

[English](README.md) | 简体中文

**把书签、标签页组和网页快照保存在自己的服务器上。**

<p align="center">
  <a href="docs/media/markvault-intro.mp4"><img src="docs/media/markvault-intro.gif" width="720" alt="15 秒了解 MarkVault：书签、界面主题、标签页组与统计" /></a><br />
  <sub>15 秒介绍 · <a href="docs/media/markvault-intro.mp4">观看高清视频（MP4，1080p）</a></sub>
</p>

[![代码检查](https://github.com/xinmang/MarkVault/actions/workflows/ci.yml/badge.svg)](https://github.com/xinmang/MarkVault/actions/workflows/ci.yml)
[![Go Docker 镜像](https://github.com/xinmang/MarkVault/actions/workflows/docker-image.yml/badge.svg?branch=main)](https://github.com/xinmang/MarkVault/actions/workflows/docker-image.yml)
[![许可证：CC BY-NC 4.0](https://img.shields.io/badge/license-CC_BY--NC_4.0-blue)](LICENSE)

MarkVault 是基于 [TMarks](https://github.com/ai-tmarks/tmarks) 改造的可自托管书签管理工具。REST API、SQLite 数据库、本地对象存储和构建后的 React 前端都由一个 Go 程序提供，一个容器即可运行，不需要 Cloudflare 账号、Wrangler、外部数据库或对象存储服务。附带浏览器扩展、公开分享，以及面向 AI Agent 的 REST API 和 MCP 接口。

部署方案面向单机、单容器，不支持多个副本共享同一数据目录。

## 功能

| 功能             | 说明                                                                             |
| ---------------- | -------------------------------------------------------------------------------- |
| 书签与标签       | 搜索、筛选、置顶、批量整理、点击统计和回收站                                     |
| 标签页组         | 保存与整理多个网页，支持分组、待办和恢复                                         |
| 网页快照与截图   | 配合扩展保存带版本的网页快照，并把 X、linux.do 等站点的帖子生成图文卡片          |
| 公开分享         | 分享书签集合或标签页组，可设置有效期                                             |
| 数据统计         | 点击趋势、排行和热力图；Agent / MCP 的调用量、成功率与耗时                       |
| 浏览器扩展       | Chromium 扩展，连接自己的实例                                                    |
| AI、Agent 与 MCP | 站内聊天、第三方 AI 服务、API Key、REST API 和 MCP；站内写操作需要确认           |
| 插件             | 界面主题（含 ASCII 终端、液态玻璃）、页面版式（含无限画布）、视图等在设置里开关，另可安装自定义插件 |
| 导入导出         | JSON 导入导出，兼容旧版 TMarks JSON                                              |
| 语言             | 中英双语界面                                                                     |

## 快速开始

需要 Docker Engine 24+ 与 Docker Compose v2。

```bash
git clone https://github.com/xinmang/MarkVault.git
cd MarkVault
cp .env.example .env      # PowerShell 用 Copy-Item .env.example .env
mkdir -p data/go && sudo chown 1000:1000 data/go   # 仅 Linux，必须在首次启动前完成
docker compose pull app
docker compose up -d --no-build --wait
```

打开 **http://localhost:8787** 注册账号。`curl http://localhost:8787/api/v1/health` 可检查服务是否正常。

- 首个注册的账号成为管理员，随后自动关闭注册。管理员可在设置中重新开放。
- 容器以 UID/GID `1000:1000` 运行。Linux 上新建的数据目录必须像上面那样先交给该用户再首次启动，否则容器无法写入 `/data`。
- 端口默认只绑定 `127.0.0.1`（`APP_BIND`）。公网访问请在前面放置提供 HTTPS 的反向代理。
- 默认镜像为 `ghcr.io/xinmang/markvault:latest`。生产环境请在 `.env` 中用 `MARKVAULT_IMAGE` 固定版本标签或镜像摘要。

配置项、HTTPS、源码构建、更新和故障排查见 [部署指南](DEPLOYMENT.md)。已实施的防护与部署者责任见 [SECURITY.md](SECURITY.md)。

## 本地开发

需要 `go.mod` 声明的 Go 工具链、Node.js 22+（`.nvmrc` 使用 24）和 pnpm 9.7.1。Node 只用于前端构建与开发。

```bash
pnpm install --frozen-lockfile
pnpm build         # 构建前端到 dist/
pnpm start         # 启动 Go 服务，http://localhost:8787
pnpm dev           # 可选，另开终端：Vite 开发服务器，http://localhost:5173
```

`pnpm start` 不会构建前端。接口正常但页面 404 时，先执行 `pnpm build`。首次启动时服务会应用数据库迁移并生成实例密钥。开发约定、验证命令和版本发布规则见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 数据与备份

- 全部数据在一个数据目录里：Compose 默认 `./data/go`，原生运行默认 `.data/go`，设置 `MARKVAULT_DATA_DIR` 后以其值为准。其中有 SQLite 数据库、对象文件（快照、图片、截图）和 `config/runtime.env` 中的实例密钥。
- 完整备份时先停止服务，再复制整个目录，包括 SQLite 的 WAL 配套文件和 `config/runtime.env`。步骤见 [备份与恢复](DEPLOYMENT.md#备份与恢复)。
- 设置中的 JSON 导出只包含业务数据，不含快照文件、图片和实例密钥，不能用于完整实例恢复。
- 旧版本（Go 之前）的数据目录不能直接挂载，需要用 `cmd/markvault-migrate` 离线转换，见 [Go 部署与迁移](docs/GO-DEPLOYMENT.md)。

## 浏览器扩展

1. 在实例的“浏览器”页面或 [最新 Release](https://github.com/xinmang/markvault-extension/releases/latest) 下载 `markvault-extension-chrome.zip`。
2. 解压后打开 `chrome://extensions/` 或 `edge://extensions/`，开启开发者模式，选择“加载已解压的扩展程序”。
3. 在 MarkVault 的设置中创建权限合适的 API Key，在扩展中填写实例地址和 Key。
4. 如扩展请求携带跨域来源，把该来源（例如 `chrome-extension://<扩展 ID>`）加入 `CORS_ALLOWED_ORIGINS`，再执行 `docker compose up -d`。

扩展在 [markvault-extension](https://github.com/xinmang/markvault-extension) 独立维护。

## Agent 与 MCP

| 入口                  | 用途                          |
| --------------------- | ----------------------------- |
| `GET /api/v1/agent`   | 无需登录的能力索引            |
| `/api/v1/agent/*`     | 书签、标签、搜索等 REST API   |
| `POST /api/mcp`       | MCP 接口，按 Key 权限提供工具 |
| `/openapi-agent.json` | OpenAPI 契约                  |
| `/llms.txt`           | Agent 文档索引                |

接入细节见 [API 参考](public/markvault/references/api.md) 和 [Agent Skill](public/markvault/SKILL.md)。API Key 按用途授予最小权限；MCP 写工具需要 `confirm: true`。

## 插件

界面主题、配色、页面版式、书签／标签／标签页组视图、海洋背景、图床、通行密钥和外部 MCP 连接等内置功能，都在设置页对应的分区里开关和配置。第三方插件在「设置 → 自定义插件」（`/plugins`）管理：管理员可通过离线目录、ZIP 或固定的 GitHub Release 资产安装。`/plugins?safe=1` 会跳过可选插件，用于恢复管理。开发与部署方式见 [插件文档](docs/plugins.md)。

## 文档

以下详细文档目前为中文。

- [部署指南](DEPLOYMENT.md)：配置项、HTTPS、备份恢复、数据目录权限、故障排查
- [Go 部署与迁移](docs/GO-DEPLOYMENT.md)：旧实例迁移、离线预构建
- [参与贡献](CONTRIBUTING.md)：开发约定、验证命令、版本号与发布
- [安全说明](SECURITY.md)：漏洞报告、已实施的防护、部署边界
- [插件](docs/plugins.md)、[图床](docs/image-hosting.md)、[注册控制与通行密钥](docs/passkeys-and-registration.md)
- [Agent API 参考](public/markvault/references/api.md) 和 [Agent Skill](public/markvault/SKILL.md)

问题反馈和功能建议请提交到 [MarkVault Issues](https://github.com/xinmang/MarkVault/issues)。

## 致谢

MarkVault 用到了以下两个项目：

- **[TMarks](https://github.com/ai-tmarks/tmarks)**，作者 TMarks Team。MarkVault 基于它改造：整理了仓库结构，后端改为 Go 单程序、本地 SQLite 与对象存储，并扩展了数据迁移、Agent / MCP 接入和界面偏好。仓库保留 TMarks Team 署名，沿用 CC BY-NC 4.0 许可证。MarkVault 是独立修改版本，不代表上游项目。
- **[ascii-sharks](https://github.com/stackedlol/ascii-sharks)**（MIT）。ASCII 海洋背景（鲨鱼、海豚或两者混合）参考了该项目用 ASCII 字符展示海洋的方式，鱼群模拟和字符渲染改编自它。原许可证保存在 [plugins/builtin/ocean/engine/LICENSE](plugins/builtin/ocean/engine/LICENSE)。

## 许可证

源代码以 **CC BY-NC 4.0** 提供，不允许商业用途。使用、修改和分发时请遵守 [LICENSE](LICENSE)，其中保留了 TMarks Team 的署名。第三方依赖仍适用各自的许可证。
