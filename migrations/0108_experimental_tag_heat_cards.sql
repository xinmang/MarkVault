-- 标签点击热度的收藏卡分级背景特效。旧显示样式保持不变。
ALTER TABLE user_preferences ADD COLUMN experimental_tag_heat_effect TEXT NOT NULL DEFAULT 'auto';

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0108');
