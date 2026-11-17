-- 插件包和用户状态纳入 SQLite 完整备份，业务导出不包含这些表。
CREATE TABLE plugin_versions (
 plugin_id TEXT NOT NULL, version TEXT NOT NULL, manifest TEXT NOT NULL,
 digest TEXT NOT NULL, archive BLOB NOT NULL, source TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(plugin_id, version)
);
CREATE TABLE plugin_installations (
 plugin_id TEXT PRIMARY KEY, version TEXT NOT NULL, previous_version TEXT,
 disabled INTEGER NOT NULL DEFAULT 0, generation INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE plugin_users (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, plugin_id TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0, config TEXT NOT NULL DEFAULT '{}',
 grants TEXT NOT NULL DEFAULT '[]', generation INTEGER NOT NULL DEFAULT 1,
 exposed_tools TEXT NOT NULL DEFAULT '[]', PRIMARY KEY(user_id, plugin_id)
);
CREATE TABLE plugin_config_snapshots (
 plugin_id TEXT NOT NULL, version TEXT NOT NULL, user_id TEXT NOT NULL,
 config TEXT NOT NULL, grants TEXT NOT NULL, enabled INTEGER NOT NULL,
 PRIMARY KEY(plugin_id, version, user_id)
);
CREATE TABLE plugin_storage (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, plugin_id TEXT NOT NULL,
 key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(user_id, plugin_id, key)
);
CREATE TABLE plugin_credentials (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, plugin_id TEXT NOT NULL,
 name TEXT NOT NULL, target TEXT NOT NULL, ciphertext TEXT NOT NULL,
 PRIMARY KEY(user_id, plugin_id, name)
);
CREATE TABLE plugin_audit (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, plugin_id TEXT NOT NULL,
 operation TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE plugin_tool_confirmations (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 plugin_id TEXT NOT NULL, tool TEXT NOT NULL, arguments TEXT NOT NULL,
 revision TEXT NOT NULL, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE plugin_mcp_connections (
 id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL, url TEXT NOT NULL, transport TEXT NOT NULL,
 auth_header TEXT NOT NULL DEFAULT '', ciphertext TEXT NOT NULL DEFAULT '',
 tools TEXT NOT NULL DEFAULT '[]', selected TEXT NOT NULL DEFAULT '[]',
 generation INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(user_id, id)
);
ALTER TABLE agent_pending_actions ADD COLUMN plugin_revision TEXT NOT NULL DEFAULT '';
CREATE TABLE plugin_catalogs(source TEXT PRIMARY KEY, entries TEXT NOT NULL, updated_at TEXT NOT NULL);
ALTER TABLE plugin_users ADD COLUMN last_error TEXT NOT NULL DEFAULT '';
ALTER TABLE agent_usage_events ADD COLUMN plugin_id TEXT NOT NULL DEFAULT '';
ALTER TABLE agent_usage_events ADD COLUMN tool_source TEXT NOT NULL DEFAULT '';
ALTER TABLE agent_usage_events ADD COLUMN connection_id TEXT NOT NULL DEFAULT '';
