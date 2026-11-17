-- UI/UX Pro Max 推荐的现代柔光界面风格。默认关闭，并与其他实验性全站主题互斥使用。
ALTER TABLE user_preferences ADD COLUMN experimental_uiux_pro_theme_enabled INTEGER NOT NULL DEFAULT 0;

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0112');
