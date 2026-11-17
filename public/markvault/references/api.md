# MarkVault Agent API

## 连接约定

- 基础地址：环境变量 `MARKVAULT_BASE_URL`，例如 `http://localhost:8787`
- API Key：环境变量 `MARKVAULT_API_KEY`
- REST 鉴权：`X-API-Key: <key>`
- 稳定 REST 前缀：`/api/v1/agent`
- MCP 端点：`POST /api/mcp`
- 数据格式：`application/json`

不要在 URL、日志或对话正文中暴露完整 API Key。建议为每个 Agent 创建独立 Key，并按用途选择 `READ_ONLY`、`BASIC` 或 `FULL` 模板。

## REST 端点

调用元数据会记录到账号的「数据统计 → Agent 与 MCP」，用于查看次数、结果和耗时。REST 请求按接口计数，MCP 按工具调用逐项计数；不保存请求参数、对话或返回内容。统计从升级后开始累积，仅账号本人的登录会话可读取，API Key 无统计读取权限。

| 端点                                        | 所需权限           | 用途                     |
| ------------------------------------------- | ------------------ | ------------------------ |
| `GET /api/v1/agent`                         | 无                 | 查看版本、文档与端点索引 |
| `GET /api/v1/agent/me`                      | `user.read`        | 验证连接并查看账户统计   |
| `GET /api/v1/agent/search`                  | `bookmarks.read`   | 搜索书签字段和标签名     |
| `GET /api/v1/agent/bookmarks`               | `bookmarks.read`   | 分页筛选和排序书签       |
| `POST /api/v1/agent/bookmarks`              | `bookmarks.create` | 创建书签                 |
| `GET /api/v1/agent/bookmarks/:id`           | `bookmarks.read`   | 读取书签详情             |
| `PATCH /api/v1/agent/bookmarks/:id`         | `bookmarks.update` | 修改书签                 |
| `DELETE /api/v1/agent/bookmarks/:id`        | `bookmarks.delete` | 移入回收站               |
| `PATCH /api/v1/agent/bookmarks/:id/restore` | `bookmarks.update` | 恢复书签                 |
| `GET /api/v1/agent/tags`                    | `tags.read`        | 列出标签及书签数量       |
| `POST /api/v1/agent/tags`                   | `tags.create`      | 创建标签                 |
| `GET /api/v1/agent/tags/:id`                | `tags.read`        | 读取标签详情             |
| `PATCH /api/v1/agent/tags/:id`              | `tags.update`      | 修改标签名称或颜色       |
| `DELETE /api/v1/agent/tags/:id`             | `tags.delete`      | 删除标签并解除书签关联   |

创建或更新书签时，使用 `tag_ids` 还需要 `tags.assign`；使用 `tags` 名称自动创建或关联标签时还需要 `tags.assign` 和 `tags.create`。

写入权限不包含读取权限。缺少对应 `.read` 权限时，写入响应仅返回记录 ID 或操作计数，不返回原记录的标题、描述、标签和图片签名。重复创建已有 URL 仍可返回 `already_exists`，但不会额外授予读取权限；重新保存回收站中的 URL 需要 `bookmarks.update`，未提交标签字段时保留原有标签。

保存快照需要 `bookmarks.create`；如果达到保留上限、需要淘汰旧版本，还必须具备 `bookmarks.update`。仅有创建权限的 Key 不会触发删除旧快照。

## 书签请求示例

创建：

```json
{
  "title": "MarkVault",
  "url": "https://example.com",
  "description": "自托管书签工具",
  "tags": ["工具", "待读"],
  "is_pinned": false,
  "is_public": false
}
```

更新时仅提交需要改变的字段：

```json
{
  "title": "MarkVault 文档",
  "is_public": true
}
```

## 搜索与分页

`GET /api/v1/agent/search?q=Docker&limit=10`

响应中的 `data.results.bookmarks` 是匹配书签，`data.results.tags` 是名称匹配的标签。

`GET /api/v1/agent/bookmarks?sort=updated&page_size=20`

| 参数          | 说明                                            |
| ------------- | ----------------------------------------------- |
| `keyword`     | 搜索书签标题、描述和网址                        |
| `tags`        | 逗号分隔的标签 ID；多个 ID 表示同时包含全部标签 |
| `sort`        | `created`、`updated`、`pinned` 或 `popular`     |
| `pinned`      | `true` 或 `false`                               |
| `page_size`   | 每页数量，默认 `100`，范围 `1-200`              |
| `page_cursor` | 上一页返回的不透明游标                          |

将 `next_cursor` 原样作为下一次请求的 `page_cursor`；不要解析或修改它。

## MCP

MCP 使用无状态 Streamable HTTP：

- URL：`POST /api/mcp`
- 鉴权：`X-API-Key`，也支持 `Authorization: Bearer mvk_...`
- 协议版本：`2025-06-18`，兼容 `2025-03-26` 与 `2024-11-05`
- 支持：`initialize`、`ping`、`tools/list`、`tools/call`
- 工具列表会按当前 Key 权限过滤
- 所有写工具必须在用户明确确认后传入 `confirm: true`

内置工具共 13 个，覆盖账户概况、搜索、书签和标签的读取、创建与修改，书签的软删除与恢复，以及不可恢复的标签删除。

## 通用响应与错误

成功响应：

```json
{ "data": {} }
```

常见状态码：

- `400`：参数缺失或无效。
- `401`：API Key 缺失、无效、过期或已撤销。
- `403`：API Key 缺少端点所需权限。
- `404`：目标不存在或不属于当前账户。
- `409`：重复数据或写操作尚未确认。
- `429`：达到调用限制；读取 `Retry-After` 后再重试。
- `500`：服务端错误，不要连续重试。

成功鉴权的响应会返回 `X-RateLimit-Limit`、`X-RateLimit-Remaining` 和 `X-RateLimit-Reset`。

## 插件化接口补充

原 Agent REST 和 /api/mcp 地址、内置工具名称保持兼容；对应插件停用时服务器拒绝调用。POST /api/v1/agent/chat 可传 agentId，默认 markvault.agent，第三方格式为 插件ID/贡献ID。插件及外部 MCP 工具默认仅站内可见，写入和第三方工具均需确认。确认凭证绑定插件版本及配置代次，撤权、停用和升级后失效。对外开放必须同时配置用户工具清单和 API Key 的精确工具权限，既有 Key 不自动获得新增工具。插件管理 API 只接受登录会话。
