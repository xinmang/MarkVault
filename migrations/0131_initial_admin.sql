-- 初始化只执行一次，删除首个账号后也不能由下一位注册者重新领取管理员权限。
CREATE TABLE instance_initialization (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    initialized_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 旧实例保留已有管理员；没有管理员时由最早注册的账号管理站点。
-- 同一时刻注册的账号使用插入顺序确定先后。
UPDATE users SET role = 'admin'
WHERE id = (SELECT id FROM users ORDER BY julianday(created_at), rowid LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin');

INSERT INTO instance_initialization (id)
SELECT 1 WHERE EXISTS (SELECT 1 FROM users);

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0131');
