package server

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"markvault/plugins"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
	"time"

	"markvault/internal/config"
)

func (f *fixture) requestFrom(remote, method, path string, body any, headers map[string]string) *httptest.ResponseRecorder {
	f.t.Helper()
	data, err := json.Marshal(body)
	if err != nil {
		f.t.Fatal(err)
	}
	r := httptest.NewRequest(method, path, bytes.NewReader(data))
	r.RemoteAddr = remote
	r.Header.Set("Content-Type", "application/json")
	for key, value := range headers {
		r.Header.Set(key, value)
	}
	w := httptest.NewRecorder()
	f.handler.ServeHTTP(w, r)
	return w
}

func TestClientIPTrustsOnlyConfiguredProxies(t *testing.T) {
	proxies, err := config.ParseTrustedProxies("10.0.0.0/8, 2001:db8::1")
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{config: config.Config{TrustedProxies: proxies}}
	cases := []struct{ name, remote, forwarded, want string }{
		{"不可信对端忽略请求头", "203.0.113.9:4000", "198.51.100.7", "203.0.113.9"},
		{"可信代理取最右侧不可信地址", "10.0.0.2:4000", "6.6.6.6, 198.51.100.7", "198.51.100.7"},
		{"跳过多级可信代理", "10.0.0.2:4000", "198.51.100.7, 10.1.1.1", "198.51.100.7"},
		{"格式错误回退代理地址", "10.0.0.2:4000", "198.51.100.7, not-an-ip", "10.0.0.2"},
		{"缺少请求头使用代理地址", "10.0.0.2:4000", "", "10.0.0.2"},
		{"IPv6 可信代理", "[2001:db8::1]:4000", "2001:db8:1:2::5", "2001:db8:1:2::5"},
	}
	for _, c := range cases {
		r := httptest.NewRequest("GET", "/", nil)
		r.RemoteAddr = c.remote
		if c.forwarded != "" {
			r.Header.Set("X-Forwarded-For", c.forwarded)
		}
		if got := s.clientIP(r); got != c.want {
			t.Fatalf("%s: clientIP=%s，预期 %s", c.name, got, c.want)
		}
	}
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "[2001:db8:aaaa:bbbb:1:2:3:4]:4000"
	if got := (&Server{}).rateIP(r); got != "2001:db8:aaaa:bbbb::/64" {
		t.Fatalf("IPv6 限流键应按 /64 归并: %s", got)
	}
	if _, err := config.ParseTrustedProxies("0.0.0.0/0"); err == nil {
		t.Fatal("不应允许信任全部地址")
	}
	if _, err := config.ParseTrustedProxies("proxy.local"); err == nil {
		t.Fatal("应拒绝无效代理地址")
	}
}

func TestLoginFailuresLockUsernameAcrossAddresses(t *testing.T) {
	f := setup(t)
	f.account("victim")
	f.account("bystander")
	for i := 0; i < loginFailureLimit; i++ {
		remote := netip.AddrFrom4([4]byte{198, 51, 100, byte(i + 1)}).String() + ":5000"
		check(t, f.requestFrom(remote, "POST", "/api/v1/auth/login", object{"username": "Victim", "password": "wrong-password"}, nil), 401)
	}
	locked := f.requestFrom("203.0.113.50:5000", "POST", "/api/v1/auth/login", object{"username": "victim", "password": "password-123"}, nil)
	check(t, locked, 429)
	if locked.Header().Get("Retry-After") == "" {
		t.Fatal("账号锁定响应缺少重试时间")
	}
	check(t, f.requestFrom("203.0.113.51:5000", "POST", "/api/v1/auth/login", object{"username": "bystander", "password": "password-123"}, nil), 200)
	check(t, f.requestFrom("203.0.113.52:5000", "POST", "/api/v1/auth/login", object{"username": strings.Repeat("x", 129), "password": "password-123"}, nil), 401)
}

func TestTrustedProxyRateLimitsRealClients(t *testing.T) {
	f := setupConfig(t, func(c *config.Config) {
		c.TrustedProxies, _ = config.ParseTrustedProxies("127.0.0.1")
	})
	for i := 0; i < 10; i++ {
		check(t, f.requestFrom("127.0.0.1:9000", "POST", "/api/v1/auth/login", object{"username": "nobody" + string(rune('a'+i)), "password": "wrong-password"}, map[string]string{"X-Forwarded-For": "198.51.100.10"}), 401)
	}
	check(t, f.requestFrom("127.0.0.1:9000", "POST", "/api/v1/auth/login", object{"username": "nobody-z", "password": "wrong-password"}, map[string]string{"X-Forwarded-For": "198.51.100.10"}), 429)
	// 代理后的其他客户端不再共用同一个限流额度。
	check(t, f.requestFrom("127.0.0.1:9000", "POST", "/api/v1/auth/login", object{"username": "nobody-y", "password": "wrong-password"}, map[string]string{"X-Forwarded-For": "198.51.100.11"}), 401)
}

func TestExpiredSessionsArePruned(t *testing.T) {
	f := setup(t)
	_, login := f.account("pruned")
	uid := str(login["user"].(map[string]any)["id"])
	past := time.Now().UTC().Add(-time.Hour).Format(time.RFC3339Nano)
	future := time.Now().UTC().Add(time.Hour).Format(time.RFC3339Nano)
	revokedLongAgo := time.Now().UTC().Add(-48 * time.Hour).Format("2006-01-02T15:04:05.000Z")
	for _, row := range []struct {
		hash, expires string
		revoked       any
	}{{"expired", past, nil}, {"revoked-old", future, revokedLongAgo}, {"active", future, nil}} {
		if _, err := f.db.Exec("INSERT INTO auth_tokens(user_id,refresh_token_hash,expires_at,revoked_at) VALUES(?,?,?,?)", uid, row.hash, row.expires, row.revoked); err != nil {
			t.Fatal(err)
		}
	}
	stamp := time.Now().Unix()
	if _, err := f.db.Exec("INSERT INTO revoked_access_tokens(token_hash,expires_at) VALUES('old',?),('fresh',?)", stamp-10, stamp+600); err != nil {
		t.Fatal(err)
	}
	s := &Server{db: f.db, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	s.cleanupExpired(context.Background(), stamp)
	var tokens, revoked int
	if err := f.db.QueryRow("SELECT (SELECT COUNT(*) FROM auth_tokens WHERE refresh_token_hash IN ('expired','revoked-old')),(SELECT COUNT(*) FROM revoked_access_tokens WHERE token_hash='old')").Scan(&tokens, &revoked); err != nil {
		t.Fatal(err)
	}
	if tokens != 0 || revoked != 0 {
		t.Fatalf("过期会话未清理: tokens=%d revoked=%d", tokens, revoked)
	}
	var active int
	if err := f.db.QueryRow("SELECT (SELECT COUNT(*) FROM auth_tokens WHERE refresh_token_hash='active')+(SELECT COUNT(*) FROM revoked_access_tokens WHERE token_hash='fresh')").Scan(&active); err != nil || active != 2 {
		t.Fatalf("仍有效的会话记录被误删: %d %v", active, err)
	}
}

func TestImportIsRateLimitedAndSerialized(t *testing.T) {
	f := setup(t)
	token, _ := f.account("importer")
	payload := object{"format": "markvault", "bookmarks": []object{}, "tags": []object{}}
	for i := 0; i < 10; i++ {
		check(t, f.request("POST", "/api/v1/import", token, payload), 200)
	}
	check(t, f.request("POST", "/api/v1/import", token, payload), 429)

	// 已有导入占用连接时，新的导入立即返回 429，不排队占用请求体内存。
	// 换一个账号，确保拒绝来自占用标记而不是频率限制。
	_, login := f.account("importer_two")
	s := &Server{db: f.db, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	s.importBusy.Store(true)
	body, _ := json.Marshal(payload)
	r := httptest.NewRequest("POST", "/api/v1/import", bytes.NewReader(body))
	r = r.WithContext(context.WithValue(r.Context(), authContextKey{}, &principal{UserID: str(login["user"].(map[string]any)["id"])}))
	err := s.importData(httptest.NewRecorder(), r)
	if e, ok := err.(*httpError); !ok || e.status != 429 {
		t.Fatalf("导入进行中时应返回 429: %v", err)
	}
	if !s.importBusy.Load() {
		t.Fatal("被拒绝的导入不能释放他人持有的占用标记")
	}
}

func TestAgentConfirmationShowsSensitiveChanges(t *testing.T) {
	update, _ := plugins.FindTool("markvault_update_bookmark")
	action := (plugins.Assistant{}).Pending(modelCall{ID: "call-1", Name: update.Name, Arguments: object{"id": "b1", "title": "新标题", "is_public": true, "tags": []any{"x"}}}, update)
	summary := str(action["summary"])
	if action["destructive"] != true || !strings.Contains(summary, "设为公开") || !strings.Contains(summary, "修改标题") || !strings.Contains(summary, "修改标签") {
		t.Fatalf("公开书签的确认卡片必须醒目说明: %v", action)
	}
	private := (plugins.Assistant{}).Pending(modelCall{ID: "call-2", Name: update.Name, Arguments: object{"id": "b1", "is_public": false}}, update)
	if private["destructive"] != false || !strings.Contains(str(private["summary"]), "设为私密") {
		t.Fatalf("设为私密不是危险操作: %v", private)
	}
	create, _ := plugins.FindTool("markvault_create_bookmark")
	if action := (plugins.Assistant{}).Pending(modelCall{ID: "call-3", Name: create.Name, Arguments: object{"title": "公开", "url": "https://example.com", "is_public": true}}, create); action["destructive"] != true {
		t.Fatalf("直接创建公开书签也需要危险确认: %v", action)
	}
}

func TestPublicPayloadsHideInternalFields(t *testing.T) {
	f := setup(t)
	token, _ := f.account("publisher")
	check(t, f.request("PUT", "/api/v1/settings/share", token, object{"enabled": true, "slug": "publisher"}), 200)
	bookmark := data(t, f.request("POST", "/api/v1/bookmarks", token, object{"title": "公开", "url": "https://public.example/", "is_public": true}), 201)["bookmark"].(map[string]any)
	check(t, f.request("POST", "/api/v1/bookmarks/"+str(bookmark["id"])+"/click", token, nil), 200)
	for _, path := range []string{"/api/public/publisher", "/api/public/publisher?page_size=10"} {
		rows := data(t, f.request("GET", path, "", nil), 200)["bookmarks"].([]any)
		if len(rows) != 1 {
			t.Fatalf("公开书签数量错误: %v", rows)
		}
		row := rows[0].(map[string]any)
		for _, hidden := range []string{"user_id", "last_clicked_at", "snapshot_retention_count", "deleted_at", "pin_order", "group_id"} {
			if _, ok := row[hidden]; ok {
				t.Fatalf("%s 不应出现在公开书签中: %v", hidden, row)
			}
		}
		if number(row["click_count"]) != 1 || row["has_snapshot"] != false {
			t.Fatalf("公开书签缺少展示字段: %v", row)
		}
	}
	group := data(t, f.request("POST", "/api/v1/tab-groups", token, object{"title": "分享组"}), 201)
	gid := str(group["tab_group"].(map[string]any)["id"])
	share := data(t, f.request("POST", "/api/v1/tab-groups/"+gid+"/share", token, object{"is_public": true}), 200)
	public := data(t, f.request("GET", "/api/share/"+str(share["share_token"]), "", nil), 200)
	if _, ok := public["tab_group"].(map[string]any)["user_id"]; ok {
		t.Fatalf("分享的标签页组不应暴露账号 ID: %v", public["tab_group"])
	}
}
