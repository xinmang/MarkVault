-- ASCII 终端界面主题：边框、按钮、背景与动画均用字符绘制。默认关闭，与其他界面主题互斥。
ALTER TABLE user_preferences ADD COLUMN experimental_ascii_theme_enabled INTEGER NOT NULL DEFAULT 0;
