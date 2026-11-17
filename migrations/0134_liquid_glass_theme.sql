-- 液态玻璃界面主题：半透明玻璃材质，按钮与指针水滴靠近时融合（融球效果）。默认关闭，与其他界面主题互斥。
ALTER TABLE user_preferences ADD COLUMN experimental_liquid_glass_theme_enabled INTEGER NOT NULL DEFAULT 0;
