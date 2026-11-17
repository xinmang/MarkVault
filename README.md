# MarkVault

English | [简体中文](README.zh-CN.md)

**Keep your bookmarks, tab groups and web page snapshots on your own server.**

<p align="center">
  <a href="docs/media/markvault-intro.mp4"><img src="docs/media/markvault-intro.gif" width="720" alt="A 15-second tour of MarkVault: bookmarks, interface themes, tab groups and statistics" /></a><br />
  <sub>A 15-second tour · <a href="docs/media/markvault-intro.mp4">watch the full-quality video (MP4, 1080p)</a></sub>
</p>

[![CI](https://github.com/xinmang/MarkVault/actions/workflows/ci.yml/badge.svg)](https://github.com/xinmang/MarkVault/actions/workflows/ci.yml)
[![Go Docker image](https://github.com/xinmang/MarkVault/actions/workflows/docker-image.yml/badge.svg?branch=main)](https://github.com/xinmang/MarkVault/actions/workflows/docker-image.yml)
[![License: CC BY-NC 4.0](https://img.shields.io/badge/license-CC_BY--NC_4.0-blue)](LICENSE)

MarkVault is a self-hosted bookmark manager adapted from [TMarks](https://github.com/ai-tmarks/tmarks). One Go program serves the REST API, the SQLite database, local object storage and the built React frontend, so a single container is enough. It needs no Cloudflare account, Wrangler, external database or object storage service. A browser extension, public sharing, and a REST API and MCP endpoint for AI agents are included.

The deployment targets one host and one container. Multiple replicas sharing a data directory are not supported.

## Features

| Area                    | What it does                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| Bookmarks and tags      | Search, filters, pinning, batch organising, click counts and a trash                                      |
| Tab groups              | Save and organise sets of pages, with groups, to-dos and restore                                          |
| Snapshots, screenshots  | With the extension: versioned page snapshots, and image cards of posts from X, linux.do and similar sites |
| Public sharing          | Share a bookmark collection or a tab group, optionally with an expiry date                                |
| Statistics              | Click trends, rankings and a heatmap; call volume, success rate and latency for Agent / MCP usage         |
| Browser extension       | A Chromium extension that connects to your own instance                                                   |
| AI, Agent and MCP       | In-app chat, third-party AI providers, API keys, REST API and MCP; in-app write actions need confirmation |
| Plugins                 | Themes (ASCII terminal, Liquid Glass), page layouts (infinite canvas) and views in Settings; custom plugins |
| Import and export       | JSON import and export, compatible with legacy TMarks JSON                                                |
| Languages               | English and Simplified Chinese interface                                                                  |

## Quick start

Requires Docker Engine 24+ and Docker Compose v2.

```bash
git clone https://github.com/xinmang/MarkVault.git
cd MarkVault
cp .env.example .env      # PowerShell: Copy-Item .env.example .env
mkdir -p data/go && sudo chown 1000:1000 data/go   # Linux only, before the first start
docker compose pull app
docker compose up -d --no-build --wait
```

Open **http://localhost:8787** and register. `curl http://localhost:8787/api/v1/health` checks that the service is up.

- The first account to register becomes the administrator, and registration is then closed automatically. The administrator can reopen it in the settings.
- The container runs as UID/GID `1000:1000`. On Linux, a newly created data directory must be handed to that user before the first start, as shown above; otherwise the container cannot write to `/data`.
- The port is bound to `127.0.0.1` only (`APP_BIND`). For public access, put a reverse proxy with HTTPS in front of it.
- The default image is `ghcr.io/xinmang/markvault:latest`. For production, pin a version tag or digest with `MARKVAULT_IMAGE` in `.env`.

Configuration, HTTPS, building from source, updates and troubleshooting are covered in the [deployment guide](DEPLOYMENT.md). Security measures and the deployer's responsibilities are listed in [SECURITY.md](SECURITY.md).

## Local development

Requires the Go toolchain declared in `go.mod`, Node.js 22+ (`.nvmrc` uses 24) and pnpm 9.7.1. Node is only used to build and develop the frontend.

```bash
pnpm install --frozen-lockfile
pnpm build         # build the frontend into dist/
pnpm start         # run the Go server at http://localhost:8787
pnpm dev           # optional, in another terminal: Vite dev server at http://localhost:5173
```

`pnpm start` does not build the frontend. If the API responds but pages return 404, run `pnpm build` first. On first start the server applies database migrations and generates the instance keys. Conventions, verification commands and release rules are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Data and backup

- Everything lives in one data directory: `./data/go` with Compose, `.data/go` when run natively, or the value of `MARKVAULT_DATA_DIR`. It holds the SQLite database, stored objects (snapshots, images, screenshots) and the instance keys in `config/runtime.env`.
- For a full backup, stop the service and copy the whole directory, including the SQLite WAL files and `config/runtime.env`. See [backup and restore](DEPLOYMENT.md#备份与恢复).
- The JSON export in the settings contains business data only. It has no snapshot files, images or instance keys and cannot restore a full instance.
- Data directories from the legacy (pre-Go) version cannot be mounted directly. Convert them offline with `cmd/markvault-migrate`, as described in [Go deployment and migration](docs/GO-DEPLOYMENT.md).

## Browser extension

1. Download `markvault-extension-chrome.zip` from the "Browser" page of your instance or from the [latest release](https://github.com/xinmang/markvault-extension/releases/latest).
2. Unzip it, open `chrome://extensions/` or `edge://extensions/`, turn on developer mode and choose "Load unpacked".
3. Create an API key with suitable permissions in the MarkVault settings, then enter the instance URL and the key in the extension.
4. If the extension sends a cross-origin `Origin`, add it (for example `chrome-extension://<extension-id>`) to `CORS_ALLOWED_ORIGINS` and run `docker compose up -d`.

The extension is maintained separately in [markvault-extension](https://github.com/xinmang/markvault-extension).

## Agent and MCP

| Entry point           | Purpose                                             |
| --------------------- | --------------------------------------------------- |
| `GET /api/v1/agent`   | Capability index, no login required                 |
| `/api/v1/agent/*`     | REST API for bookmarks, tags, search and more       |
| `POST /api/mcp`       | MCP endpoint; tools depend on the key's permissions |
| `/openapi-agent.json` | OpenAPI contract                                    |
| `/llms.txt`           | Documentation index for agents                      |

See the [API reference](public/markvault/references/api.md) and the [Agent Skill](public/markvault/SKILL.md). Grant each API key the least permissions it needs. MCP write tools require `confirm: true`.

## Plugins

Built-in features — interface themes, colour palettes, page layouts, bookmark / tag / tab group views, the ocean background, image hosting, passkeys and external MCP connections — are switched on and configured in the matching section of Settings. Third-party plugins are managed under Settings → Custom plugins (`/plugins`): administrators can install them from the offline catalog, a ZIP file or a pinned GitHub Release asset. `/plugins?safe=1` skips optional plugins for recovery. Development and deployment are described in the [plugin guide](docs/plugins.md).

## Documentation

The detailed guides are currently written in Chinese.

- [Deployment guide](DEPLOYMENT.md): configuration, HTTPS, backup and restore, data directory permissions, troubleshooting
- [Go deployment and migration](docs/GO-DEPLOYMENT.md): migrating a legacy instance, offline prebuilt image
- [Contributing](CONTRIBUTING.md): development conventions, verification commands, versioning and releases
- [Security](SECURITY.md): reporting vulnerabilities, implemented protections, deployment boundaries
- [Plugins](docs/plugins.md), [image hosting](docs/image-hosting.md), [registration and passkeys](docs/passkeys-and-registration.md)
- [Agent API reference](public/markvault/references/api.md) and [Agent Skill](public/markvault/SKILL.md)

Bug reports and feature requests go to [MarkVault Issues](https://github.com/xinmang/MarkVault/issues).

## Acknowledgements

MarkVault builds on two projects:

- **[TMarks](https://github.com/ai-tmarks/tmarks)** by the TMarks Team. MarkVault is adapted from it: the repository was reorganised, the backend became a single Go program with local SQLite and object storage, and data migration, Agent / MCP access and interface preferences were extended. The TMarks Team attribution is kept and the CC BY-NC 4.0 license is retained. MarkVault is an independent modified version and does not represent the upstream project.
- **[ascii-sharks](https://github.com/stackedlol/ascii-sharks)** (MIT). The ASCII ocean background (sharks, dolphins or both) follows this project's way of drawing an ocean in ASCII characters, and its fish simulation and character rendering are adapted from it. The original license is kept in [plugins/builtin/ocean/engine/LICENSE](plugins/builtin/ocean/engine/LICENSE).

## License

The source code is provided under **CC BY-NC 4.0**, which does not permit commercial use. Follow [LICENSE](LICENSE) when using, modifying or distributing it; the TMarks Team attribution is preserved there. Third-party dependencies remain under their own licenses.
