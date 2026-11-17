-- 首页标签排序偏好。布局字段已存在，本迁移补齐排序持久化。
ALTER TABLE user_preferences ADD COLUMN tag_sort_by TEXT NOT NULL DEFAULT 'usage';

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0110');
