-- 实验性书签悬停收藏卡的显示比例，100 表示原始尺寸。
ALTER TABLE user_preferences ADD COLUMN experimental_hover_card_size INTEGER NOT NULL DEFAULT 100;
