-- 标签图标支持自动识别、内置图标和自定义图片。
ALTER TABLE tags ADD COLUMN icon TEXT DEFAULT NULL;
ALTER TABLE user_preferences ADD COLUMN show_tag_icons INTEGER NOT NULL DEFAULT 1;
