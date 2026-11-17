-- 收藏卡视图在标签筛选时执行收牌和重新发牌动画。默认关闭。
ALTER TABLE user_preferences ADD COLUMN experimental_hover_card_shuffle_enabled INTEGER NOT NULL DEFAULT 0;

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0109');
