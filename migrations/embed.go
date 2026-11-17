package migrations

import "embed"

// Files 将历史 SQL 作为唯一模式来源，避免同时维护两份数据库结构。
//
//go:embed *.sql
var Files embed.FS
