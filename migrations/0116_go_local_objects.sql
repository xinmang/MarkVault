-- 本地快照图片和持久化文件清理队列。
CREATE TABLE IF NOT EXISTS snapshot_images (
 snapshot_id TEXT NOT NULL REFERENCES bookmark_snapshots(id) ON DELETE CASCADE,
 image_hash TEXT NOT NULL,
 r2_key TEXT NOT NULL UNIQUE,
 mime_type TEXT NOT NULL,
 PRIMARY KEY(snapshot_id,image_hash)
);
CREATE TABLE IF NOT EXISTS object_gc (r2_key TEXT PRIMARY KEY);
CREATE TRIGGER IF NOT EXISTS snapshot_object_gc AFTER DELETE ON bookmark_snapshots BEGIN
 INSERT OR IGNORE INTO object_gc(r2_key) VALUES(OLD.r2_key);
END;
CREATE TRIGGER IF NOT EXISTS snapshot_image_object_gc AFTER DELETE ON snapshot_images BEGIN
 INSERT OR IGNORE INTO object_gc(r2_key) VALUES(OLD.r2_key);
END;
CREATE TRIGGER IF NOT EXISTS bookmark_image_object_gc AFTER DELETE ON bookmark_images BEGIN
 INSERT OR IGNORE INTO object_gc(r2_key) VALUES(OLD.r2_key);
END;
INSERT OR IGNORE INTO schema_migrations(version) VALUES ('0116');
