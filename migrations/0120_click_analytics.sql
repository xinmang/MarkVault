-- 标签点击明细：与 bookmark_click_events 对应，按日期统计标签点击。
-- 此前的标签点击只累加 tags.click_count，没有时间信息，无法补录到明细。
CREATE TABLE IF NOT EXISTS tag_click_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tag_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    clicked_at TEXT NOT NULL,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tag_click_events_user_clicked_at ON tag_click_events(user_id, clicked_at);
CREATE INDEX IF NOT EXISTS idx_tag_click_events_tag_clicked_at ON tag_click_events(tag_id, clicked_at);

-- 统计按时间戳字符串比较区间，历史数据统一为服务端写入的 UTC 格式（YYYY-MM-DDTHH:MM:SS.SSSZ）。
UPDATE bookmark_click_events
SET clicked_at = strftime('%Y-%m-%dT%H:%M:%fZ', clicked_at)
WHERE clicked_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
  AND strftime('%Y-%m-%dT%H:%M:%fZ', clicked_at) IS NOT NULL;
