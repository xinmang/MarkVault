package legacy

import (
	"context"
	"crypto/md5"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"markvault/internal/database"
)

func legacyFixture(t *testing.T) (string, map[string][]byte) {
	t.Helper()
	dir := t.TempDir()
	for _, subdir := range []string{"database/miniflare-D1DatabaseObject", "storage/miniflare-R2BucketObject", "storage/markvault-storage/blobs", "config"} {
		if err := os.MkdirAll(filepath.Join(dir, subdir), 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "config", "runtime.env"), []byte("JWT_SECRET="+strings.Repeat("s", 64)+"\nENCRYPTION_KEY="+strings.Repeat("e", 64)+"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	db, err := database.Open(context.Background(), filepath.Join(dir, "database/miniflare-D1DatabaseObject/test.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	if err := database.Migrate(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	// 保持数据库打开以覆盖有 WAL 的源数据备份。
	t.Cleanup(func() { db.Close() })
	if _, err := db.Exec(`INSERT INTO users(id,username,password_hash) VALUES('user','legacy','unchanged');
	INSERT INTO bookmarks(id,user_id,title,url) VALUES('bookmark','user','旧书签','https://example.com');
	INSERT INTO bookmark_snapshots(id,bookmark_id,user_id,version,content_hash,r2_key,file_size,snapshot_url,snapshot_title) VALUES('snapshot','bookmark','user',1,'hash','user/bookmark/snapshot.html',100,'https://example.com','旧快照');
	INSERT INTO bookmark_images(id,bookmark_id,user_id,image_hash,r2_key,file_size,mime_type,original_url) VALUES('cover','bookmark','user','cover.png','images/cover.png',8,'image/png','https://example.com/image.png');`); err != nil {
		t.Fatal(err)
	}
	r2, err := sql.Open("sqlite", filepath.Join(dir, "storage/miniflare-R2BucketObject/r2.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer r2.Close()
	if _, err := r2.Exec(`CREATE TABLE _mf_objects(key TEXT PRIMARY KEY,blob_id TEXT,size INTEGER,etag TEXT,http_metadata TEXT)`); err != nil {
		t.Fatal(err)
	}
	objects := map[string][]byte{
		"user/bookmark/snapshot.html":       []byte(`<html><img src="/api/snapshot-images/svg-image?u=user"></html>`),
		"user/bookmark/v1/images/svg-image": []byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`),
		"images/cover.png":                  []byte("封面图片"),
	}
	for key, content := range objects {
		blob := sha256.Sum256([]byte(key))
		blobID := hex.EncodeToString(blob[:])
		etag := md5.Sum(content)
		mime := "image/png"
		if strings.HasSuffix(key, ".html") {
			mime = "text/html"
		} else if strings.HasSuffix(key, "svg-image") {
			mime = "image/svg+xml"
		}
		meta, err := json.Marshal(map[string]string{"contentType": mime})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := r2.Exec("INSERT INTO _mf_objects VALUES(?,?,?,?,?)", key, blobID, len(content), hex.EncodeToString(etag[:]), string(meta)); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "storage/markvault-storage/blobs", blobID), content, 0600); err != nil {
			t.Fatal(err)
		}
	}
	return dir, objects
}

func TestImportPreservesDataSecretsAndImages(t *testing.T) {
	source, objects := legacyFixture(t)
	secret, err := os.ReadFile(filepath.Join(source, "config/runtime.env"))
	if err != nil {
		t.Fatal(err)
	}
	destination := filepath.Join(t.TempDir(), "go-data")
	report, err := Import(context.Background(), source, destination)
	if err != nil {
		t.Fatal(err)
	}
	if report.Objects != len(objects) || report.SnapshotImages != 1 || report.Tables["bookmarks"] != 1 || report.Tables["bookmark_images"] != 1 {
		t.Fatalf("迁移统计错误: %+v", report)
	}
	for key, content := range objects {
		copied, err := os.ReadFile(filepath.Join(destination, "objects", filepath.FromSlash(key)))
		if err != nil || string(copied) != string(content) {
			t.Fatalf("对象不一致: %s %v", key, err)
		}
	}
	copiedSecret, err := os.ReadFile(filepath.Join(destination, "config/runtime.env"))
	if err != nil || string(copiedSecret) != string(secret) {
		t.Fatal("原实例密钥没有保留")
	}
	db, err := database.Open(context.Background(), filepath.Join(destination, "database/markvault.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var hash, mime string
	if err := db.QueryRow("SELECT password_hash FROM users WHERE id='user'").Scan(&hash); err != nil || hash != "unchanged" {
		t.Fatal("旧账号数据被修改")
	}
	if err := db.QueryRow("SELECT mime_type FROM snapshot_images WHERE snapshot_id='snapshot' AND image_hash='svg-image'").Scan(&mime); err != nil || mime != "image/svg+xml" {
		t.Fatalf("旧快照图片索引无效: %s %v", mime, err)
	}
	if _, err := Import(context.Background(), source, destination); err == nil {
		t.Fatal("迁移不应覆盖已有目录")
	}
}

func TestImportRejectsCorruptObjectsAndRemovesPartialDirectory(t *testing.T) {
	for _, mode := range []string{"missing", "corrupt", "traversal", "multipart"} {
		t.Run(mode, func(t *testing.T) {
			source, _ := legacyFixture(t)
			blobs := filepath.Join(source, "storage/markvault-storage/blobs")
			files, err := os.ReadDir(blobs)
			if err != nil {
				t.Fatal(err)
			}
			switch mode {
			case "missing":
				err = os.Remove(filepath.Join(blobs, files[0].Name()))
			case "corrupt":
				err = os.WriteFile(filepath.Join(blobs, files[0].Name()), []byte("损坏的数据"), 0600)
			default:
				r2, openErr := sql.Open("sqlite", filepath.Join(source, "storage/miniflare-R2BucketObject/r2.sqlite"))
				if openErr != nil {
					t.Fatal(openErr)
				}
				if mode == "traversal" {
					_, err = r2.Exec("UPDATE _mf_objects SET key='../escape' WHERE key='images/cover.png'")
				} else {
					_, err = r2.Exec("UPDATE _mf_objects SET blob_id=NULL WHERE key='images/cover.png'")
				}
				r2.Close()
			}
			if err != nil {
				t.Fatal(err)
			}
			parent := t.TempDir()
			destination := filepath.Join(parent, "go-data")
			if _, err := Import(context.Background(), source, destination); err == nil {
				t.Fatal("损坏或不安全的对象不应完成迁移")
			}
			files, err = os.ReadDir(parent)
			if err != nil || len(files) != 0 {
				t.Fatalf("失败迁移留下了不完整目录: %v %v", files, err)
			}
		})
	}
}
