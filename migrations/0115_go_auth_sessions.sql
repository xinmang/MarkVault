-- Go 服务保存撤销记录，同时兼容原实例签发的访问令牌。
CREATE TABLE IF NOT EXISTS revoked_access_tokens (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS auth_versions (user_id TEXT PRIMARY KEY, version INTEGER NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
INSERT OR IGNORE INTO schema_migrations(version) VALUES ('0115');

