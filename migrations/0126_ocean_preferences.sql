-- 默认沿用浏览器本地选择，升级不覆盖已有海洋彩蛋。
ALTER TABLE user_preferences ADD COLUMN ocean_background_scope TEXT NOT NULL DEFAULT 'browser'
    CHECK (ocean_background_scope IN ('browser', 'account'));
ALTER TABLE user_preferences ADD COLUMN ocean_background TEXT NOT NULL DEFAULT 'off'
    CHECK (ocean_background IN ('off', 'sharks', 'dolphins', 'mixed'));
