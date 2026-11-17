-- 仅保存用户主动批准的免确认工具；远端定义变化时清空。
ALTER TABLE plugin_mcp_connections ADD COLUMN auto_approved TEXT NOT NULL DEFAULT '[]';
