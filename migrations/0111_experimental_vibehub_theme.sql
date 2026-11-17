-- 使用 VibeHub 视觉语言覆盖前端样式，保留 MarkVault 原有图标体系。默认关闭。
ALTER TABLE user_preferences ADD COLUMN experimental_vibehub_theme_enabled INTEGER NOT NULL DEFAULT 0;

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0111');
