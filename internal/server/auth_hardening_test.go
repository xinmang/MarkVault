package server

import (
	"crypto/pbkdf2"
	"crypto/sha256"
	"encoding/base64"
	"strings"
	"testing"
	"time"

	"markvault/internal/auth"
)

func TestLoginUpgradesLegacyPassword(t *testing.T) {
	f := setup(t)
	token, _ := f.account("legacy_password")
	salt := []byte("legacy-salt-1234")
	digest, err := pbkdf2.Key(sha256.New, "password-123", salt, 100000, 32)
	if err != nil {
		t.Fatal(err)
	}
	legacy := "pbkdf2_sha256:100000:" + base64.StdEncoding.EncodeToString(append(salt, digest...))
	if _, err := f.db.Exec("UPDATE users SET password_hash=? WHERE username=?", legacy, "legacy_password"); err != nil {
		t.Fatal(err)
	}
	check(t, f.request("POST", "/api/v1/auth/login", "", object{"username": "legacy_password", "password": "incorrect"}), 401)
	var stored string
	if err := f.db.QueryRow("SELECT password_hash FROM users WHERE username=?", "legacy_password").Scan(&stored); err != nil || stored != legacy {
		t.Fatalf("失败的登录修改了密码: %v", err)
	}
	login := data(t, f.request("POST", "/api/v1/auth/login", "", object{"username": "legacy_password", "password": "password-123"}), 200)
	if err := f.db.QueryRow("SELECT password_hash FROM users WHERE username=?", "legacy_password").Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(stored, "pbkdf2_sha256:600000:") || !auth.VerifyPassword("password-123", stored) || auth.VerifyPassword("incorrect", stored) {
		t.Fatal("旧密码未升级为可验证的新哈希")
	}
	check(t, f.request("GET", "/api/v1/me", str(login["access_token"]), nil), 200)
	check(t, f.request("GET", "/api/v1/me", token, nil), 200)
}

func TestRateLimitCleanupKeepsActiveWindow(t *testing.T) {
	f := setup(t)
	stamp := time.Now().Unix()
	window := stamp / 60 * 60
	for _, entry := range []struct {
		key     string
		updated int64
		count   int
	}{
		{"expired-key", stamp - 86401, 1},
		{"login:192.0.2.1", window, 10},
	} {
		if _, err := f.db.Exec("INSERT INTO rate_limits(key,window_seconds,window_start,count,updated_at) VALUES(?,60,?,?,?)", entry.key, entry.updated, entry.count, entry.updated); err != nil {
			t.Fatal(err)
		}
	}
	response := f.request("POST", "/api/v1/auth/login", "", object{"username": "missing", "password": "incorrect"})
	check(t, response, 429)
	if response.Header().Get("Retry-After") == "" {
		t.Fatal("限流响应未提供重试时间")
	}
	var count int
	if err := f.db.QueryRow("SELECT COUNT(*) FROM rate_limits WHERE key='expired-key'").Scan(&count); err != nil || count != 0 {
		t.Fatalf("过期限流记录未清理: %d %v", count, err)
	}
	if err := f.db.QueryRow("SELECT count FROM rate_limits WHERE key='login:192.0.2.1' AND window_start=?", window).Scan(&count); err != nil || count != 11 {
		t.Fatalf("有效限流窗口被重置: %d %v", count, err)
	}
}

func TestBrowserSecurityHeaders(t *testing.T) {
	f := setup(t)
	response := f.request("GET", "/api/v1/health", "", nil)
	check(t, response, 200)
	if response.Header().Get("X-Frame-Options") != "SAMEORIGIN" || !strings.Contains(response.Header().Get("Content-Security-Policy"), "frame-ancestors 'self'") {
		t.Fatal("缺少点击劫持防护")
	}
}
