package database

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"markvault/migrations"
	_ "modernc.org/sqlite"
)

func Open(ctx context.Context, path string) (*sql.DB, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0700); err != nil {
		return nil, err
	}
	uriPath := filepath.ToSlash(abs)
	if !strings.HasPrefix(uriPath, "/") {
		uriPath = "/" + uriPath
	}
	uri := url.URL{Scheme: "file", Path: uriPath}
	q := url.Values{}
	q.Add("_pragma", "foreign_keys(1)")
	q.Add("_pragma", "busy_timeout(5000)")
	q.Add("_pragma", "journal_mode(WAL)")
	uri.RawQuery = q.Encode()
	db, err := sql.Open("sqlite", uri.String())
	if err != nil {
		return nil, err
	}
	// 单实例 SQLite 串行写入，避免连接级 PRAGMA 不一致及写锁竞争。
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, err
	}
	if err := os.Chmod(abs, 0600); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

// Migrate 每个版本独立事务执行，失败时不会留下半个版本。
func Migrate(ctx context.Context, db *sql.DB) error {
	if _, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS go_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`); err != nil {
		return err
	}
	entries, err := migrations.Files.ReadDir(".")
	if err != nil {
		return err
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasSuffix(name, ".sql") {
			continue
		}
		source, err := migrations.Files.ReadFile(name)
		if err != nil {
			return err
		}
		// 统一换行，保证 Windows 本地构建与 Linux 镜像的迁移校验一致。
		source = bytes.ReplaceAll(source, []byte("\r\n"), []byte("\n"))
		checksum := fmt.Sprintf("%x", sha256.Sum256(source))
		legacyChecksum := fmt.Sprintf("%x", sha256.Sum256(bytes.ReplaceAll(source, []byte("\n"), []byte("\r\n"))))
		var previous string
		err = db.QueryRowContext(ctx, "SELECT checksum FROM go_migrations WHERE name = ?", name).Scan(&previous)
		if err == nil {
			if previous != checksum && previous != legacyChecksum {
				return fmt.Errorf("已应用的迁移 %s 内容发生变化", name)
			}
			continue
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		legacy, err := legacyApplied(ctx, db, name)
		if err != nil {
			return err
		}
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		if !legacy {
			_, err = tx.ExecContext(ctx, string(source))
		}
		if err == nil {
			_, err = tx.ExecContext(ctx, "INSERT INTO go_migrations(name, checksum) VALUES (?, ?)", name, checksum)
		}
		if err != nil {
			tx.Rollback()
			return fmt.Errorf("数据库迁移 %s: %w", name, err)
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

func legacyApplied(ctx context.Context, db *sql.DB, name string) (bool, error) {
	var exists int
	err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").Scan(&exists)
	if err != nil || exists == 0 {
		return false, err
	}
	version := strings.SplitN(name, "_", 2)[0]
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM schema_migrations WHERE version = ?", version).Scan(&exists); err != nil {
		return false, err
	}
	if exists > 0 {
		return true, nil
	}
	// 旧版最后一个迁移没有写入 schema_migrations，使用实际字段确认，不能重复 ALTER TABLE。
	if version == "0114" {
		if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM pragma_table_info('user_preferences') WHERE name = 'experimental_hover_card_size'").Scan(&exists); err != nil {
			return false, err
		}
		return exists > 0, nil
	}
	return false, nil
}

// Query 仅用于动态偏好和聚合响应；业务查询始终使用参数绑定。
func Query(ctx context.Context, db Queryer, query string, args ...any) ([]map[string]any, error) {
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0)
	for rows.Next() {
		values := make([]any, len(columns))
		ptrs := make([]any, len(columns))
		for i := range values {
			ptrs[i] = &values[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		item := make(map[string]any, len(columns))
		for i, key := range columns {
			if b, ok := values[i].([]byte); ok {
				item[key] = string(b)
			} else {
				item[key] = values[i]
			}
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

type Queryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func One(ctx context.Context, db Queryer, query string, args ...any) (map[string]any, error) {
	rows, err := Query(ctx, db, query, args...)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, sql.ErrNoRows
	}
	return rows[0], nil
}
