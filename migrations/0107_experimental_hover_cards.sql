-- 实验性书签悬停卡牌。默认关闭，升级后不改变现有交互。
ALTER TABLE user_preferences ADD COLUMN experimental_hover_card_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_preferences ADD COLUMN experimental_hover_card_theme TEXT NOT NULL DEFAULT 'creature';
ALTER TABLE user_preferences ADD COLUMN experimental_hover_card_effect TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE user_preferences ADD COLUMN experimental_hover_card_accent_color TEXT NOT NULL DEFAULT '#e11d48';
ALTER TABLE user_preferences ADD COLUMN experimental_hover_card_intensity INTEGER NOT NULL DEFAULT 75;
ALTER TABLE user_preferences ADD COLUMN experimental_hover_card_delay INTEGER NOT NULL DEFAULT 450;
ALTER TABLE user_preferences ADD COLUMN experimental_hover_card_advanced_clicks INTEGER NOT NULL DEFAULT 5;
ALTER TABLE user_preferences ADD COLUMN experimental_hover_card_collector_clicks INTEGER NOT NULL DEFAULT 20;
ALTER TABLE user_preferences ADD COLUMN experimental_hover_card_secret_clicks INTEGER NOT NULL DEFAULT 50;

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0107');
