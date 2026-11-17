-- 书签页首次显示数量与“加载更多”展开状态的有效期。
-- 每次加载数量沿用 page_size；0 分钟表示每次进入页面都恢复默认数量。
ALTER TABLE user_preferences ADD COLUMN bookmark_initial_count INTEGER NOT NULL DEFAULT 30 CHECK (bookmark_initial_count BETWEEN 1 AND 200);
ALTER TABLE user_preferences ADD COLUMN bookmark_load_more_expiry_minutes INTEGER NOT NULL DEFAULT 5 CHECK (bookmark_load_more_expiry_minutes BETWEEN 0 AND 1440);
