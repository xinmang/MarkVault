-- 首次注册前开放入口，已有账号的实例默认关闭；后续由管理员在设置中开启。
CREATE TABLE auth_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    registration_enabled INTEGER NOT NULL DEFAULT 0 CHECK (registration_enabled IN (0, 1))
);
INSERT INTO auth_settings(id,registration_enabled)
SELECT 1, NOT EXISTS (SELECT 1 FROM users);

CREATE TABLE passkey_credentials (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rp_id TEXT NOT NULL,
    name TEXT NOT NULL,
    credential TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT
);
CREATE INDEX passkey_user ON passkey_credentials(user_id,rp_id);

-- 挑战只保留五分钟，绑定发起浏览器；注册挑战还绑定登录会话和当前密码摘要。
CREATE TABLE passkey_sessions (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('register','login')),
    user_id TEXT NOT NULL DEFAULT '',
    binding TEXT NOT NULL,
    origin TEXT NOT NULL,
    session TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    auth_token TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL DEFAULT '',
    expires_at INTEGER NOT NULL
);
CREATE INDEX passkey_session_expiry ON passkey_sessions(expires_at);
INSERT OR IGNORE INTO schema_migrations(version) VALUES ('0132');
