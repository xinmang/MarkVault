-- Agent 使用统计独立保存，避免 API Key 最近 100 条日志的清理影响历史统计。
-- 仅保存调用元数据，不保存对话、参数、密钥、资源 ID 或返回内容。
CREATE TABLE IF NOT EXISTS agent_usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('chat', 'agent_api', 'mcp')),
    kind TEXT NOT NULL CHECK (kind IN ('request', 'tool')),
    operation TEXT NOT NULL,
    success INTEGER NOT NULL CHECK (success IN (0, 1)),
    duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_usage_user_time ON agent_usage_events(user_id, created_at);
