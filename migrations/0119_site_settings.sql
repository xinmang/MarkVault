-- 全站统一的品牌设置：单行表，只有管理员可以修改。
-- 名称/描述/Logo/Favicon 全站共用，登录页、分享页与公共页头读取同一份数据。
CREATE TABLE IF NOT EXISTS site_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    site_name TEXT NOT NULL DEFAULT 'MarkVault',
    site_description TEXT NOT NULL DEFAULT '',
    site_logo TEXT NOT NULL DEFAULT '',
    site_favicon TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 默认值与恢复默认都使用 MarkVault，避免已有实例升级后外观突变。
INSERT OR IGNORE INTO site_settings (id, site_name, site_description, site_logo, site_favicon)
VALUES (1, 'MarkVault', '', '', '');

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0119');
