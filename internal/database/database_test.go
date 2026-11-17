package database

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"markvault/migrations"
)

func TestMigrateLineEndingCompatibility(t *testing.T) {
	ctx := context.Background()
	db, err := Open(ctx, filepath.Join(t.TempDir(), "markvault.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := Migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	var name, storedChecksum string
	if err := db.QueryRowContext(ctx, "SELECT name, checksum FROM go_migrations ORDER BY name LIMIT 1").Scan(&name, &storedChecksum); err != nil {
		t.Fatal(err)
	}
	source, err := migrations.Files.ReadFile(name)
	if err != nil {
		t.Fatal(err)
	}
	unixSource := bytes.ReplaceAll(source, []byte("\r\n"), []byte("\n"))
	unixChecksum := fmt.Sprintf("%x", sha256.Sum256(unixSource))
	if storedChecksum != unixChecksum {
		t.Fatal("新迁移应保存统一换行后的校验值")
	}
	for _, test := range []struct {
		name   string
		source []byte
		valid  bool
	}{
		{"Linux 换行", unixSource, true},
		{"Windows 旧校验值", bytes.ReplaceAll(unixSource, []byte("\n"), []byte("\r\n")), true},
		{"内容确实变化", append(append([]byte{}, unixSource...), []byte("\n-- 修改后的迁移内容")...), false},
	} {
		t.Run(test.name, func(t *testing.T) {
			checksum := fmt.Sprintf("%x", sha256.Sum256(test.source))
			if _, err := db.ExecContext(ctx, "UPDATE go_migrations SET checksum = ? WHERE name = ?", checksum, name); err != nil {
				t.Fatal(err)
			}
			err := Migrate(ctx, db)
			if test.valid && err != nil {
				t.Fatalf("跨平台迁移应兼容: %v", err)
			}
			if !test.valid && (err == nil || !strings.Contains(err.Error(), name)) {
				t.Fatalf("真正发生内容变化时应拒绝迁移: %v", err)
			}
		})
	}
}
