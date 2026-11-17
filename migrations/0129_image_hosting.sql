-- 图床对象只保存地址，密钥继续使用 plugin_credentials 的加密存储。
CREATE TABLE image_host_objects (
 r2_key TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 purpose TEXT NOT NULL CHECK(purpose IN ('screenshot','snapshot','cover','favicon','default')),
 url TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TABLE plugin_default_images (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 r2_key TEXT NOT NULL UNIQUE,
 mime_type TEXT NOT NULL,
 file_size INTEGER NOT NULL
);
CREATE TRIGGER default_image_object_gc AFTER DELETE ON plugin_default_images BEGIN
 INSERT OR IGNORE INTO object_gc(r2_key) VALUES(OLD.r2_key);
END;
