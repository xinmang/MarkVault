-- 网站截图：浏览器扩展把帖子正文和图片渲染成的图文卡片，每个书签只保留最新一张。
CREATE TABLE IF NOT EXISTS bookmark_screenshots (
 id TEXT PRIMARY KEY,
 bookmark_id TEXT NOT NULL UNIQUE REFERENCES bookmarks(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 r2_key TEXT NOT NULL UNIQUE,
 mime_type TEXT NOT NULL,
 width INTEGER NOT NULL,
 height INTEGER NOT NULL,
 file_size INTEGER NOT NULL,
 source_url TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bookmark_screenshots_user ON bookmark_screenshots(user_id);
-- 删除截图（包括随书签或账号级联删除）时把文件加入清理队列。
CREATE TRIGGER IF NOT EXISTS screenshot_object_gc AFTER DELETE ON bookmark_screenshots BEGIN
 INSERT OR IGNORE INTO object_gc(r2_key) VALUES(OLD.r2_key);
END;
