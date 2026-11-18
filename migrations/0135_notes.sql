-- 备注：对书签或标签页所指网站的评价与记录，例如是否需要登录、反爬情况、每天的签到结果。
-- 与描述不同，一条记录可以有多条备注，按时间累积；置顶的备注用于保存长期有效的结论。
-- source 记录写入者：user 为本人通过登录会话添加，agent 为 API Key、MCP 或站内助手写入。
-- source_name 保存写入时的 API Key 名称，站内助手和本人留空。
CREATE TABLE IF NOT EXISTS notes (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 bookmark_id TEXT REFERENCES bookmarks(id) ON DELETE CASCADE,
 tab_item_id TEXT REFERENCES tab_group_items(id) ON DELETE CASCADE,
 content TEXT NOT NULL,
 source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'agent')),
 source_name TEXT NOT NULL DEFAULT '',
 is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 -- 每条备注只属于一个书签或一个标签页。
 CHECK ((bookmark_id IS NULL) <> (tab_item_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_notes_bookmark ON notes(bookmark_id, is_pinned, created_at) WHERE bookmark_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notes_tab_item ON notes(tab_item_id, is_pinned, created_at) WHERE tab_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id);
