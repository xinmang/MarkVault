-- 实验性界面功能偏好。全部默认关闭，升级后不会改变现有界面。
ALTER TABLE user_preferences ADD COLUMN experimental_tag_heat_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_preferences ADD COLUMN experimental_tag_heat_style TEXT NOT NULL DEFAULT 'fill';
ALTER TABLE user_preferences ADD COLUMN experimental_tag_heat_color TEXT NOT NULL DEFAULT '#3b82f6';
ALTER TABLE user_preferences ADD COLUMN experimental_tag_heat_intensity INTEGER NOT NULL DEFAULT 65;

ALTER TABLE user_preferences ADD COLUMN experimental_url_privacy_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_preferences ADD COLUMN experimental_url_privacy_effect TEXT NOT NULL DEFAULT 'blur';
ALTER TABLE user_preferences ADD COLUMN experimental_url_privacy_strength INTEGER NOT NULL DEFAULT 6;

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0106');
