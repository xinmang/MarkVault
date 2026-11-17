# 持久化目录

Compose 默认把 `./data/go` 挂载到容器 `/data`（可用 `MARKVAULT_DATA_DIR` 覆盖）；原生运行默认使用 `.data/go`。

```text
data/go/
├── database/markvault.sqlite   业务数据库（SQLite）
├── objects/                    快照、快照图片、封面图和图标
├── config/runtime.env          自动生成的 JWT 与加密密钥
└── migration-report.json       仅在使用迁移工具时生成
```

- 运行期间数据库目录可能出现 `markvault.sqlite-wal` 与 `markvault.sqlite-shm`，备份时必须一并保存。
- 容器以 UID/GID `1000:1000` 运行。Linux 宿主机上新建空目录可先 `mkdir -p data/go && sudo chown 1000:1000 data/go`。
- 完整备份或迁移必须整体复制数据目录，并单独保管 `config/runtime.env`；更换 `ENCRYPTION_KEY` 会使已保存的 AI 密钥不可解密。
- 旧版 `data/database`、`data/storage`、`data/config` 不能直接作为新版数据目录，需先用 `cmd/markvault-migrate` 离线迁移，见 [../docs/GO-DEPLOYMENT.md](../docs/GO-DEPLOYMENT.md)。
- 不要把其中的实际数据、备份或密钥提交到 Git。
