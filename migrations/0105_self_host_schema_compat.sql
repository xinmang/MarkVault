-- 补齐当前 API 实际使用、但旧版基础迁移未创建的书签字段。
ALTER TABLE bookmarks ADD COLUMN pin_order INTEGER DEFAULT NULL;
ALTER TABLE bookmarks ADD COLUMN snapshot_retention_count INTEGER DEFAULT NULL;
ALTER TABLE bookmarks ADD COLUMN group_id TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_bookmarks_pin_order
  ON bookmarks(user_id, is_pinned DESC, pin_order ASC);

CREATE INDEX IF NOT EXISTS idx_bookmarks_group_id
  ON bookmarks(user_id, group_id);

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0105');
