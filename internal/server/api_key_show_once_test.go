package server

import (
	"context"
	"database/sql"
	"net/http"
	"strings"
	"testing"

	"markvault/internal/auth"
	"markvault/internal/database"
)

func TestAPIKeyOnlyReturnedOnCreation(t *testing.T) {
	f := setup(t)
	token, _ := f.account("alice")
	response := f.request("POST", "/api/v1/settings/api-keys", token, object{"name": "扩展"})
	created := data(t, response, 201)
	key, kid := str(created["key"]), str(created["id"])
	if !strings.HasPrefix(key, "mvk_live_") || len(key) != len("mvk_live_")+64 {
		t.Fatal("创建时应返回完整 API Key")
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("创建响应不应缓存完整密钥")
	}
	var hash string
	var encrypted sql.NullString
	if err := f.db.QueryRow("SELECT key_hash,key_encrypted FROM api_keys WHERE id=?", kid).Scan(&hash, &encrypted); err != nil {
		t.Fatal(err)
	}
	if hash != auth.HashAPIKey(key) || encrypted.Valid {
		t.Fatal("数据库应只保存哈希，不保存可还原的密钥")
	}
	for _, request := range []struct {
		method, path string
		body         any
	}{
		{"GET", "/api/v1/settings/api-keys", nil},
		{"GET", "/api/v1/settings/api-keys/" + kid, nil},
		{"PATCH", "/api/v1/settings/api-keys/" + kid, object{"name": "更新后的扩展"}},
	} {
		w := f.request(request.method, request.path, token, request.body)
		check(t, w, 200)
		for _, secret := range []string{key, "key_hash", "key_encrypted", "revealable"} {
			if strings.Contains(w.Body.String(), secret) {
				t.Fatalf("%s %s 不应返回密钥或存储字段", request.method, request.path)
			}
		}
	}
	// 已登录用户也没有重新获取密钥的接口。
	if w := f.request("GET", "/api/v1/settings/api-keys/"+kid+"/secret", token, nil); w.Code != http.StatusNotFound {
		t.Fatalf("完整密钥接口应不存在，状态码=%d", w.Code)
	}
	check(t, f.request("GET", "/api/v1/bookmarks", key, nil), 200)
}

func TestAPIKeyMigrationRemovesEncryptedSecretAndKeepsAuthentication(t *testing.T) {
	f := setup(t)
	token, _ := f.account("alice")
	created := data(t, f.request("POST", "/api/v1/settings/api-keys", token, object{"name": "旧版扩展"}), 201)
	key, kid := str(created["key"]), str(created["id"])
	if _, err := f.db.Exec("UPDATE api_keys SET key_encrypted=? WHERE id=?", "历史密文", kid); err != nil {
		t.Fatal(err)
	}
	if _, err := f.db.Exec("DELETE FROM go_migrations WHERE name='0124_api_key_show_once.sql'"); err != nil {
		t.Fatal(err)
	}
	if err := database.Migrate(context.Background(), f.db); err != nil {
		t.Fatal(err)
	}
	var encrypted sql.NullString
	if err := f.db.QueryRow("SELECT key_encrypted FROM api_keys WHERE id=?", kid).Scan(&encrypted); err != nil {
		t.Fatal(err)
	}
	if encrypted.Valid {
		t.Fatal("迁移应清除历史密文")
	}
	check(t, f.request("GET", "/api/v1/bookmarks", key, nil), 200)
}
