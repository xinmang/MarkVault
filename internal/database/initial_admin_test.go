package database

import (
	"context"
	"path/filepath"
	"testing"
)

func TestInitialAdminMigration(t *testing.T) {
	for _, test := range []struct {
		name          string
		existingAdmin bool
		sameTime      bool
		empty         bool
	}{
		{name: "空实例等待首个注册", empty: true},
		{name: "旧实例最早账号成为管理员"},
		{name: "注册时间相同按插入顺序", sameTime: true},
		{name: "保留已有管理员", existingAdmin: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx := context.Background()
			db, err := Open(ctx, filepath.Join(t.TempDir(), "db.sqlite"))
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			if err := Migrate(ctx, db); err != nil {
				t.Fatal(err)
			}
			// 还原到迁移前的状态，使用实际迁移入口验证升级和重复启动。
			if _, err := db.Exec("DROP TABLE instance_initialization; DELETE FROM go_migrations WHERE name='0131_initial_admin.sql'; DELETE FROM schema_migrations WHERE version='0131'"); err != nil {
				t.Fatal(err)
			}
			if !test.empty {
				firstTime, laterTime := "2025-01-01T00:00:00Z", "2025-01-02T00:00:00Z"
				if test.sameTime {
					laterTime = firstTime
				}
				role := "user"
				if test.existingAdmin {
					role = "admin"
				}
				if _, err := db.Exec("INSERT INTO users(id,username,password_hash,role,created_at) VALUES('first','first','hash','user',?),('later','later','hash',?,?)", firstTime, role, laterTime); err != nil {
					t.Fatal(err)
				}
			}
			if err := Migrate(ctx, db); err != nil {
				t.Fatal(err)
			}
			var initialized int
			if err := db.QueryRow("SELECT COUNT(*) FROM instance_initialization").Scan(&initialized); err != nil {
				t.Fatal(err)
			}
			if test.empty {
				if initialized != 0 {
					t.Fatal("空实例不能预先消耗管理员资格")
				}
				return
			}
			var id string
			if err := db.QueryRow("SELECT id FROM users WHERE role='admin'").Scan(&id); err != nil {
				t.Fatal(err)
			}
			want := "first"
			if test.existingAdmin {
				want = "later"
			}
			var admins int
			if err := db.QueryRow("SELECT COUNT(*) FROM users WHERE role='admin'").Scan(&admins); err != nil {
				t.Fatal(err)
			}
			if id != want || admins != 1 || initialized != 1 {
				t.Fatalf("升级结果错误：管理员=%s 数量=%d 初始化标记=%d", id, admins, initialized)
			}
			if _, err := db.Exec("UPDATE users SET role='user'"); err != nil {
				t.Fatal(err)
			}
			if err := Migrate(ctx, db); err != nil {
				t.Fatal(err)
			}
			if err := db.QueryRow("SELECT COUNT(*) FROM users WHERE role='admin'").Scan(&admins); err != nil || admins != 0 {
				t.Fatal("重复启动重新授予了管理员权限")
			}
		})
	}
}

func TestRegistrationSettingsMigrationClosesExistingInstance(t *testing.T) {
	ctx := context.Background()
	db, err := Open(ctx, filepath.Join(t.TempDir(), "db.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := Migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("DROP TABLE passkey_sessions; DROP TABLE passkey_credentials; DROP TABLE auth_settings; DELETE FROM go_migrations WHERE name='0132_registration_passkeys.sql'; DELETE FROM schema_migrations WHERE version='0132'; INSERT INTO users(id,username,password_hash) VALUES('owner','owner','hash')"); err != nil {
		t.Fatal(err)
	}
	if err := Migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	var enabled bool
	if err := db.QueryRow("SELECT registration_enabled FROM auth_settings WHERE id=1").Scan(&enabled); err != nil || enabled {
		t.Fatal("已有账号的实例升级后应关闭注册")
	}
	if _, err := db.Exec("UPDATE auth_settings SET registration_enabled=1"); err != nil {
		t.Fatal(err)
	}
	if err := Migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow("SELECT registration_enabled FROM auth_settings WHERE id=1").Scan(&enabled); err != nil || !enabled {
		t.Fatal("重复启动覆盖了管理员的注册设置")
	}
}
