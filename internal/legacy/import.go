// Package legacy 将原版本地 D1/R2 存储转换为 Go 服务的数据目录。
package legacy

import (
	"context"
	"crypto/md5" // 仅校验原版 R2 对象的 ETag，不用于安全签名。
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"

	"markvault/internal/config"
	"markvault/internal/database"
)

type Report struct {
	Tables         map[string]int64 `json:"tables"`
	Objects        int              `json:"objects"`
	Bytes          int64            `json:"bytes"`
	SnapshotImages int              `json:"snapshot_images"`
}

type r2Object struct {
	Key, BlobID, ETag, MIME string
	Size                    int64
}

var imageURL = regexp.MustCompile(`/api/snapshot-images/([a-zA-Z0-9._-]+)`)
var imageHash = regexp.MustCompile(`^[a-zA-Z0-9._-]{1,128}$`)

// Import 只读源数据，先完成临时目录内的校验，再发布目标目录；拒绝覆盖已有目录。
// 跨数据库和对象文件的一致性要求调用方在迁移期间暂停原版服务的写入。
func Import(ctx context.Context, source, destination string) (Report, error) {
	report := Report{Tables: map[string]int64{}}
	source, err := filepath.Abs(source)
	if err != nil {
		return report, err
	}
	destination, err = filepath.Abs(destination)
	if err != nil {
		return report, err
	}
	if _, err := os.Lstat(destination); !errors.Is(err, os.ErrNotExist) {
		return report, errors.New("目标目录已经存在或不可访问，请使用新的空路径")
	}
	d1, err := onlyDatabase(filepath.Join(source, "database", "miniflare-D1DatabaseObject"))
	if err != nil {
		return report, err
	}
	r2, err := onlyDatabase(filepath.Join(source, "storage", "miniflare-R2BucketObject"))
	if err != nil {
		return report, err
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0700); err != nil {
		return report, err
	}
	stage, err := os.MkdirTemp(filepath.Dir(destination), "."+filepath.Base(destination)+"-import-")
	if err != nil {
		return report, err
	}
	defer os.RemoveAll(stage)
	for _, dir := range []string{"database", "config", "objects"} {
		if err := os.Mkdir(filepath.Join(stage, dir), 0700); err != nil {
			return report, err
		}
	}
	secret, err := os.ReadFile(filepath.Join(source, "config", "runtime.env"))
	if err != nil {
		return report, fmt.Errorf("读取原实例密钥: %w", err)
	}
	if err := os.WriteFile(filepath.Join(stage, "config", "runtime.env"), secret, 0600); err != nil {
		return report, err
	}
	cfg := config.Config{DataDir: stage}
	if err := cfg.PrepareSecrets(); err != nil {
		return report, fmt.Errorf("验证原实例密钥: %w", err)
	}
	dbPath := filepath.Join(stage, "database", "markvault.sqlite")
	if err := backup(ctx, d1, dbPath); err != nil {
		return report, fmt.Errorf("备份原数据库: %w", err)
	}
	r2Path := filepath.Join(stage, "r2-metadata.sqlite")
	if err := backup(ctx, r2, r2Path); err != nil {
		return report, fmt.Errorf("备份 R2 索引: %w", err)
	}
	objects, err := readObjects(ctx, r2Path)
	if err != nil {
		return report, err
	}
	if err := os.Remove(r2Path); err != nil {
		return report, err
	}
	blobRoot, err := os.OpenRoot(filepath.Join(source, "storage", "markvault-storage", "blobs"))
	if err != nil {
		return report, err
	}
	defer blobRoot.Close()
	objectRoot, err := os.OpenRoot(filepath.Join(stage, "objects"))
	if err != nil {
		return report, err
	}
	for key, object := range objects {
		if err := ctx.Err(); err != nil {
			objectRoot.Close()
			return report, err
		}
		if err := copyObject(blobRoot, objectRoot, object); err != nil {
			objectRoot.Close()
			return report, fmt.Errorf("校验并复制对象 %s: %w", key, err)
		}
		report.Objects++
		report.Bytes += object.Size
	}
	objectRoot.Close()
	db, err := database.Open(ctx, dbPath)
	if err != nil {
		return report, err
	}
	defer db.Close()
	if err := database.Migrate(ctx, db); err != nil {
		return report, err
	}
	if err := indexImages(ctx, db, stage, objects, &report); err != nil {
		return report, err
	}
	rows, err := database.Query(ctx, db, "SELECT r2_key FROM bookmark_images")
	if err != nil {
		return report, err
	}
	for _, row := range rows {
		if _, ok := objects[row["r2_key"].(string)]; !ok {
			return report, errors.New("原版封面记录引用了不存在的 R2 对象")
		}
	}
	for _, table := range []string{"users", "bookmarks", "tags", "bookmark_tags", "bookmark_snapshots", "bookmark_images", "tab_groups", "tab_group_items", "api_keys", "api_key_logs", "ai_settings"} {
		var count int64
		if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table).Scan(&count); err != nil {
			return report, err
		}
		report.Tables[table] = count
	}
	var integrity string
	if err := db.QueryRowContext(ctx, "PRAGMA integrity_check").Scan(&integrity); err != nil || integrity != "ok" {
		return report, errors.New("迁移后的数据库完整性校验失败")
	}
	foreignKeys, err := database.Query(ctx, db, "PRAGMA foreign_key_check")
	if err != nil {
		return report, err
	}
	if len(foreignKeys) != 0 {
		return report, errors.New("迁移后的数据库存在外键不一致")
	}
	if _, err := db.ExecContext(ctx, "PRAGMA wal_checkpoint(TRUNCATE)"); err != nil {
		return report, err
	}
	if err := db.Close(); err != nil {
		return report, err
	}
	encoded, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return report, err
	}
	if err := os.WriteFile(filepath.Join(stage, "migration-report.json"), append(encoded, '\n'), 0600); err != nil {
		return report, err
	}
	if _, err := os.Lstat(destination); !errors.Is(err, os.ErrNotExist) {
		return report, errors.New("迁移期间目标目录已被创建，拒绝覆盖")
	}
	if err := os.Rename(stage, destination); err != nil {
		return report, err
	}
	return report, nil
}

func onlyDatabase(dir string) (string, error) {
	matches, err := filepath.Glob(filepath.Join(dir, "*.sqlite"))
	if err != nil || len(matches) != 1 {
		return "", fmt.Errorf("目录 %s 必须恰好包含一个 SQLite 数据库", dir)
	}
	return matches[0], nil
}

func openReadOnly(file string) (*sql.DB, error) {
	file = filepath.ToSlash(file)
	if !strings.HasPrefix(file, "/") {
		file = "/" + file
	}
	uri := url.URL{Scheme: "file", Path: file, RawQuery: "mode=ro&_pragma=busy_timeout(5000)"}
	db, err := sql.Open("sqlite", uri.String())
	if err == nil {
		db.SetMaxOpenConns(1)
	}
	return db, err
}

func backup(ctx context.Context, source, destination string) error {
	db, err := openReadOnly(source)
	if err != nil {
		return err
	}
	defer db.Close()
	// VACUUM INTO 读取包含 WAL 在内的一致性快照，不修改源数据库。
	_, err = db.ExecContext(ctx, "VACUUM INTO ?", destination)
	return err
}

func readObjects(ctx context.Context, file string) (map[string]r2Object, error) {
	db, err := openReadOnly(file)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	rows, err := database.Query(ctx, db, "SELECT key,blob_id,size,etag,http_metadata FROM _mf_objects")
	if err != nil {
		return nil, err
	}
	objects := make(map[string]r2Object, len(rows))
	for _, row := range rows {
		key, _ := row["key"].(string)
		blob, _ := row["blob_id"].(string)
		if key == "" || path.Clean(key) != key || !filepath.IsLocal(filepath.FromSlash(key)) || strings.Contains(key, `\`) {
			return nil, errors.New("原版 R2 索引含有不安全的对象路径")
		}
		if blob == "" {
			return nil, errors.New("检测到 multipart R2 对象，需要先从原版导出完整对象")
		}
		if _, err := hex.DecodeString(blob); err != nil {
			return nil, errors.New("原版 R2 blob 标识无效")
		}
		var metadata struct {
			ContentType string `json:"contentType"`
		}
		if err := json.Unmarshal([]byte(row["http_metadata"].(string)), &metadata); err != nil {
			return nil, err
		}
		objects[key] = r2Object{Key: key, BlobID: blob, Size: row["size"].(int64), ETag: row["etag"].(string), MIME: metadata.ContentType}
	}
	return objects, nil
}

func copyObject(source, destination *os.Root, object r2Object) error {
	in, err := source.Open(object.BlobID)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := destination.MkdirAll(filepath.Dir(filepath.FromSlash(object.Key)), 0700); err != nil {
		return err
	}
	out, err := destination.OpenFile(filepath.FromSlash(object.Key), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	digest := md5.New()
	n, copyErr := io.Copy(io.MultiWriter(out, digest), in)
	if err := errors.Join(copyErr, out.Sync(), out.Close()); err != nil {
		return err
	}
	if n != object.Size || !strings.EqualFold(hex.EncodeToString(digest.Sum(nil)), object.ETag) {
		return errors.New("对象长度或 ETag 与原版索引不符")
	}
	return nil
}

func indexImages(ctx context.Context, db *sql.DB, stage string, objects map[string]r2Object, report *Report) error {
	snapshots, err := database.Query(ctx, db, "SELECT id,user_id,bookmark_id,version,r2_key FROM bookmark_snapshots")
	if err != nil {
		return err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	root, err := os.OpenRoot(filepath.Join(stage, "objects"))
	if err != nil {
		return err
	}
	defer root.Close()
	for _, snapshot := range snapshots {
		key := snapshot["r2_key"].(string)
		if _, ok := objects[key]; !ok {
			return errors.New("原版快照记录引用了不存在的 R2 对象")
		}
		content, err := root.ReadFile(filepath.FromSlash(key))
		if err != nil {
			return err
		}
		prefix := fmt.Sprintf("%s/%s/v%d/images/", snapshot["user_id"], snapshot["bookmark_id"], snapshot["version"])
		for _, match := range imageURL.FindAllSubmatch(content, -1) {
			hash := string(match[1])
			if _, ok := objects[prefix+hash]; !ok {
				return errors.New("原版快照 HTML 引用的图片对象不存在")
			}
		}
		for key, object := range objects {
			if !strings.HasPrefix(key, prefix) {
				continue
			}
			hash := strings.TrimPrefix(key, prefix)
			if !imageHash.MatchString(hash) || !strings.HasPrefix(object.MIME, "image/") {
				return errors.New("原版快照图片标识或 MIME 无效")
			}
			result, err := tx.ExecContext(ctx, "INSERT OR IGNORE INTO snapshot_images(snapshot_id,image_hash,r2_key,mime_type) VALUES(?,?,?,?)", snapshot["id"], hash, key, object.MIME)
			if err != nil {
				return err
			}
			count, err := result.RowsAffected()
			if err != nil {
				return err
			}
			report.SnapshotImages += int(count)
		}
	}
	return tx.Commit()
}
