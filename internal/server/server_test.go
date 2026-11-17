package server

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"markvault/internal/config"
	"markvault/internal/database"
	"markvault/plugins"
)

type fixture struct {
	t       *testing.T
	handler http.Handler
	db      *sql.DB
	dir     string
}

func setup(t *testing.T) *fixture { return setupConfig(t, nil) }
func setupConfig(t *testing.T, configure func(*config.Config)) *fixture {
	t.Helper()
	dir := t.TempDir()
	db, err := database.Open(context.Background(), filepath.Join(dir, "db.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if err := database.Migrate(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{DataDir: dir, WebDir: filepath.Join(dir, "web"), JWTSecret: strings.Repeat("s", 64), EncryptionKey: strings.Repeat("e", 64), AccessTTL: time.Hour, RefreshTTL: 24 * time.Hour, AllowRegistration: true, AllowedOrigins: []string{"chrome-extension://test-extension"}, StorageLimit: 1 << 20}
	if configure != nil {
		configure(&cfg)
	}
	handler := New(db, cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), plugins.Bundle())
	t.Cleanup(func() { handler.Close() })
	return &fixture{t, handler, db, dir}
}
func (f *fixture) request(method, path, token string, body any) *httptest.ResponseRecorder {
	f.t.Helper()
	var data []byte
	if body != nil {
		var err error
		data, err = json.Marshal(body)
		if err != nil {
			f.t.Fatal(err)
		}
	}
	r := httptest.NewRequest(method, path, bytes.NewReader(data))
	r.Header.Set("Content-Type", "application/json")
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	f.handler.ServeHTTP(w, r)
	return w
}
func check(t *testing.T, w *httptest.ResponseRecorder, status int) object {
	t.Helper()
	if w.Code != status {
		t.Fatalf("状态码=%d，预期=%d，响应=%s", w.Code, status, w.Body.String())
	}
	if status == 204 || w.Body.Len() == 0 {
		return nil
	}
	var response object
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("JSON 响应无效: %s", w.Body.String())
	}
	return response
}
func data(t *testing.T, w *httptest.ResponseRecorder, status int) object {
	t.Helper()
	return check(t, w, status)["data"].(map[string]any)
}
func (f *fixture) account(name string) (string, object) {
	f.t.Helper()
	// 多账号测试显式开放注册；默认关闭规则由注册专项测试直接请求验证。
	if _, err := f.db.Exec("UPDATE auth_settings SET registration_enabled=1 WHERE id=1"); err != nil {
		f.t.Fatal(err)
	}
	check(f.t, f.request("POST", "/api/v1/auth/register", "", object{"username": name, "password": "password-123"}), 201)
	login := data(f.t, f.request("POST", "/api/v1/auth/login", "", object{"username": name, "password": "password-123"}), 200)
	return str(login["access_token"]), login
}
func TestAuthRotationAndRevocation(t *testing.T) {
	f := setup(t)
	token, login := f.account("alice")
	check(t, f.request("GET", "/api/v1/bookmarks", "", nil), 401)
	refresh := data(t, f.request("POST", "/api/v1/auth/refresh", "", object{"refresh_token": login["refresh_token"]}), 200)
	check(t, f.request("POST", "/api/v1/auth/refresh", "", object{"refresh_token": login["refresh_token"]}), 401)
	check(t, f.request("POST", "/api/v1/auth/logout", token, object{"refresh_token": refresh["refresh_token"], "revoke_all": true}), 204)
	check(t, f.request("GET", "/api/v1/bookmarks", str(refresh["access_token"]), nil), 401)
	check(t, f.request("POST", "/api/v1/auth/refresh", "", object{"refresh_token": refresh["refresh_token"]}), 401)
	// 同一秒内重新登录仍需立刻可用。
	next := data(t, f.request("POST", "/api/v1/auth/login", "", object{"username": "alice", "password": "password-123"}), 200)
	check(t, f.request("GET", "/api/v1/bookmarks", str(next["access_token"]), nil), 200)
}
func TestRefreshConcurrentSingleUse(t *testing.T) {
	f := setup(t)
	_, login := f.account("alice")
	var wg sync.WaitGroup
	codes := make(chan int, 6)
	for range 6 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			codes <- f.request("POST", "/api/v1/auth/refresh", "", object{"refresh_token": login["refresh_token"]}).Code
		}()
	}
	wg.Wait()
	close(codes)
	success := 0
	for code := range codes {
		if code == 200 {
			success++
		} else if code != 401 {
			t.Fatalf("刷新并发状态码=%d", code)
		}
	}
	if success != 1 {
		t.Fatalf("同一刷新令牌被成功使用 %d 次", success)
	}
}
func TestBookmarkIsolationAndAtomicTags(t *testing.T) {
	f := setup(t)
	a, _ := f.account("alice")
	b, _ := f.account("bob")
	tag := data(t, f.request("POST", "/api/v1/tags", b, object{"name": "私人标签"}), 201)["tag"].(map[string]any)
	check(t, f.request("POST", "/api/v1/bookmarks", a, object{"title": "越权标签", "url": "https://example.com/failed", "tag_ids": []string{str(tag["id"])}}), 400)
	bookmarks := data(t, f.request("GET", "/api/v1/bookmarks", a, nil), 200)["bookmarks"].([]any)
	if len(bookmarks) != 0 {
		t.Fatal("失败创建未回滚")
	}
	bookmark := data(t, f.request("POST", "/api/v1/bookmarks", a, object{"title": "正常书签", "url": "https://example.com/", "is_pinned": true}), 201)["bookmark"].(map[string]any)
	bid := str(bookmark["id"])
	check(t, f.request("PATCH", "/api/v1/bookmarks/"+bid, b, object{"title": "篡改"}), 404)
	check(t, f.request("DELETE", "/api/v1/bookmarks/"+bid, b, nil), 404)
	check(t, f.request("PATCH", "/api/v1/bookmarks/"+bid, a, object{"title": "必须回滚", "tag_ids": []string{str(tag["id"])}}), 400)
	after := data(t, f.request("GET", "/api/v1/bookmarks/"+bid, a, nil), 200)["bookmark"].(map[string]any)
	if after["title"] != "正常书签" {
		t.Fatal("标签校验失败未回滚标题")
	}
	check(t, f.request("POST", "/api/v1/bookmarks/"+bid+"/click", a, nil), 200)
	check(t, f.request("DELETE", "/api/v1/bookmarks/"+bid, a, nil), 204)
	check(t, f.request("GET", "/api/v1/bookmarks/trash", a, nil), 200)
	check(t, f.request("PATCH", "/api/v1/bookmarks/"+bid+"/restore", a, object{}), 200)
	check(t, f.request("DELETE", "/api/v1/bookmarks/"+bid+"/permanent", a, nil), 404)
	check(t, f.request("DELETE", "/api/v1/bookmarks/"+bid, a, nil), 204)
	check(t, f.request("DELETE", "/api/v1/bookmarks/"+bid+"/permanent", a, nil), 204)
}
func TestBookmarkPaginationAndSearch(t *testing.T) {
	f := setup(t)
	token, _ := f.account("alice")
	for i, title := range []string{"100%_命中", "其他", "第三项"} {
		check(t, f.request("POST", "/api/v1/bookmarks", token, object{"title": title, "url": "https://example.com/" + stringInt(int64(i)), "is_pinned": i < 2}), 201)
	}
	result := data(t, f.request("GET", "/api/v1/bookmarks?keyword=%25_", token, nil), 200)
	if len(result["bookmarks"].([]any)) != 1 {
		t.Fatal("LIKE 通配符未转义")
	}
	seen := map[string]bool{}
	cursor := ""
	for range 3 {
		path := "/api/v1/bookmarks?page_size=1"
		if cursor != "" {
			req := httptest.NewRequest("GET", path, nil)
			q := req.URL.Query()
			q.Set("page_cursor", cursor)
			path += "&" + strings.TrimPrefix(q.Encode(), "page_size=1&")
		}
		result = data(t, f.request("GET", path, token, nil), 200)
		rows := result["bookmarks"].([]any)
		if len(rows) != 1 {
			t.Fatalf("分页缺项: %v", result)
		}
		bid := str(rows[0].(map[string]any)["id"])
		if seen[bid] {
			t.Fatal("分页重复书签")
		}
		seen[bid] = true
		cursor = str(result["meta"].(map[string]any)["next_cursor"])
	}
	if cursor != "" || len(seen) != 3 {
		t.Fatal("分页结束状态错误")
	}
}
func TestAPIKeyPermissions(t *testing.T) {
	f := setup(t)
	token, _ := f.account("alice")
	key := data(t, f.request("POST", "/api/v1/settings/api-keys", token, object{"name": "只读", "template": "READ_ONLY"}), 201)
	check(t, f.request("GET", "/api/tab/bookmarks", str(key["key"]), nil), 200)
	check(t, f.request("POST", "/api/tab/bookmarks", str(key["key"]), object{"title": "禁止", "url": "https://example.com"}), 403)
	check(t, f.request("POST", "/api/v1/settings/api-keys", str(key["key"]), object{"name": "提权", "template": "FULL"}), 403)
	listed := data(t, f.request("GET", "/api/v1/settings/api-keys", token, nil), 200)
	if strings.Contains(stringMustJSON(listed), str(key["key"])) || strings.Contains(stringMustJSON(listed), "key_hash") {
		t.Fatal("列表泄漏 API Key")
	}
	check(t, f.request("DELETE", "/api/v1/settings/api-keys/"+str(key["id"]), token, nil), 204)
	check(t, f.request("GET", "/api/tab/bookmarks", str(key["key"]), nil), 401)
}
func stringMustJSON(v any) string { b, _ := json.Marshal(v); return string(b) }
func TestPreferencesValidateMergedThresholds(t *testing.T) {
	f := setup(t)
	token, _ := f.account("alice")
	check(t, f.request("PATCH", "/api/v1/preferences", token, object{"experimental_hover_card_size": 110, "experimental_hover_card_enabled": true}), 200)
	check(t, f.request("PATCH", "/api/v1/preferences", token, object{"experimental_hover_card_advanced_clicks": 100}), 400)
	check(t, f.request("PATCH", "/api/v1/preferences", token, object{"user_id": "other"}), 400)
	check(t, f.request("PATCH", "/api/v1/preferences", token, object{"page_size": 12.5}), 400)
	result := data(t, f.request("GET", "/api/v1/preferences", token, nil), 200)["preferences"].(map[string]any)
	if result["experimental_hover_card_size"] != float64(110) || result["experimental_hover_card_enabled"] != true {
		t.Fatal("偏好未保存或布尔值格式不兼容")
	}
}
func TestStaticAndCORS(t *testing.T) {
	f := setup(t)
	dir := filepath.Join(f.dir, "web")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html>测试</html>"), 0600); err != nil {
		t.Fatal(err)
	}
	w := f.request("GET", "/bookmarks", "", nil)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "测试") {
		t.Fatal("SPA 路由不可用")
	}
	check(t, f.request("GET", "/api/unknown", "", nil), 404)
	r := httptest.NewRequest("OPTIONS", "/api/v1/bookmarks", nil)
	r.Header.Set("Origin", "chrome-extension://test-extension")
	w = httptest.NewRecorder()
	f.handler.ServeHTTP(w, r)
	if w.Code != 204 || w.Header().Get("Access-Control-Allow-Origin") != "chrome-extension://test-extension" {
		t.Fatal("扩展 CORS 失败")
	}
	r.Header.Set("Origin", "https://untrusted.example")
	w = httptest.NewRecorder()
	f.handler.ServeHTTP(w, r)
	if w.Code != 403 || w.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("任意来源被允许")
	}
}

func TestImportExportRoundTrip(t *testing.T) {
	f := setup(t)
	token, _ := f.account("backup")
	input := object{"format": "tmarks", "version": "1.0.0", "tags": []object{{"name": "工作", "color": "#3b82f6"}}, "bookmarks": []object{{"id": "old-bookmark", "title": "文档", "url": "https://example.com/docs", "tags": []string{"工作"}, "created_at": "2024-01-01T00:00:00.000Z"}}, "tab_groups": []object{{"id": "child", "title": "子组", "parent_id": "folder", "items": []object{{"title": "文档", "url": "https://example.com/docs", "is_pinned": true}}}, {"id": "folder", "title": "文件夹", "is_folder": true, "items": []object{}}}}
	imported := data(t, f.request("POST", "/api/v1/import", token, input), 200)
	if number(imported["bookmarks"].(map[string]any)["created"]) != 1 || number(imported["tab_groups"].(map[string]any)["created"]) != 2 {
		t.Fatalf("导入失败: %+v", imported)
	}
	exported := check(t, f.request("GET", "/api/v1/export", token, nil), 200)
	if len(exported["bookmarks"].([]any)) != 1 || len(exported["tab_groups"].([]any)) != 2 {
		t.Fatalf("导出不完整: %+v", exported)
	}
	b := exported["bookmarks"].([]any)[0].(map[string]any)
	if b["id"] == "old-bookmark" || b["created_at"] != "2024-01-01T00:00:00.000Z" {
		t.Fatalf("ID 或日期映射错误: %+v", b)
	}
	second := data(t, f.request("POST", "/api/v1/import", token, exported), 200)
	if number(second["bookmarks"].(map[string]any)["skipped"]) != 1 || number(second["tab_groups"].(map[string]any)["skipped"]) != 2 {
		t.Fatalf("重复导入错误: %+v", second)
	}
	other, _ := f.account("backup_other")
	otherExport := check(t, f.request("GET", "/api/v1/export", other, nil), 200)
	if len(otherExport["bookmarks"].([]any)) != 0 {
		t.Fatal("导出泄漏其他用户数据")
	}
	input["tab_groups"] = []object{{"id": "a", "title": "a", "is_folder": true, "parent_id": "b"}, {"id": "b", "title": "b", "is_folder": true, "parent_id": "a"}}
	cycle := data(t, f.request("POST", "/api/v1/import", token, input), 200)
	if number(cycle["tab_groups"].(map[string]any)["failed"]) != 2 {
		t.Fatal("导入未拒绝循环")
	}
}
func TestGroupHierarchyAndShare(t *testing.T) {
	f := setup(t)
	token, _ := f.account("groups")
	other, _ := f.account("groups_other")
	create := func(body object) string {
		return str(data(t, f.request("POST", "/api/v1/tab-groups", token, body), 201)["tab_group"].(map[string]any)["id"])
	}
	root := create(object{"title": "根", "is_folder": true})
	child := create(object{"title": "子文件夹", "is_folder": true, "parent_id": root})
	group := create(object{"title": "标签页", "parent_id": child, "items": []object{{"title": "示例", "url": "https://example.com"}}})
	check(t, f.request("PATCH", "/api/v1/tab-groups/"+root, token, object{"parent_id": child}), 400)
	check(t, f.request("PATCH", "/api/v1/tab-groups/"+group, other, object{"title": "越权"}), 404)
	share := data(t, f.request("POST", "/api/v1/tab-groups/"+group+"/share", token, object{"is_public": true}), 200)
	path := "/api/share/" + str(share["share_token"])
	data(t, f.request("GET", path, "", nil), 200)
	data(t, f.request("POST", "/api/v1/tab-groups/"+group+"/share", token, object{"is_public": false}), 200)
	check(t, f.request("GET", path, "", nil), 404)
	check(t, f.request("DELETE", "/api/v1/tab-groups/"+root, token, nil), 204)
	check(t, f.request("GET", "/api/v1/tab-groups/"+group, token, nil), 404)
	data(t, f.request("POST", "/api/v1/tab-groups/"+root+"/restore", token, object{}), 200)
	data(t, f.request("GET", "/api/v1/tab-groups/"+group, token, nil), 200)
}
func TestSnapshotsIsolationRetentionAndGarbage(t *testing.T) {
	f := setup(t)
	token, _ := f.account("snapshots")
	other, _ := f.account("snapshots_other")
	b := data(t, f.request("POST", "/api/v1/bookmarks", token, object{"title": "网页", "url": "https://example.com"}), 201)["bookmark"].(map[string]any)
	bid := str(b["id"])
	base := "/api/v1/bookmarks/" + bid
	check(t, f.request("PATCH", base, token, object{"snapshot_retention_count": 1}), 200)
	body := object{"title": "网页", "url": "https://example.com", "html_content": "<html><script>alert(1)</script><p>旧</p></html>"}
	first := data(t, f.request("POST", base+"/snapshots", token, body), 200)["snapshot"].(map[string]any)
	view := f.request("GET", str(first["view_url"]), "", nil)
	if view.Code != 200 || !strings.Contains(view.Header().Get("Content-Security-Policy"), "sandbox") {
		t.Fatalf("签名快照查看失败: %d %s", view.Code, view.Body.String())
	}
	check(t, f.request("GET", str(first["view_url"])+"broken", "", nil), 401)
	check(t, f.request("GET", base+"/snapshots", other, nil), 404)
	duplicate := data(t, f.request("POST", base+"/snapshots", token, body), 200)
	if duplicate["is_duplicate"] != true {
		t.Fatal("未检测重复快照")
	}
	body["html_content"] = "<html><p>新</p></html>"
	second := data(t, f.request("POST", base+"/snapshots", token, body), 200)["snapshot"].(map[string]any)
	check(t, f.request("GET", str(first["view_url"]), "", nil), 404)
	list := data(t, f.request("GET", base+"/snapshots", token, nil), 200)
	if number(list["total"]) != 1 {
		t.Fatalf("保留数量错误: %+v", list)
	}
	if view = f.request("GET", base+"/snapshots/"+str(second["id"]), token, nil); view.Code != 200 {
		t.Fatalf("鉴权快照读取失败: %s", view.Body.String())
	}
	check(t, f.request("POST", base+"/snapshots", token, object{"title": "大", "url": "https://example.com", "html_content": strings.Repeat("x", 1<<20)}), 413)
	check(t, f.request("DELETE", base, token, nil), 204)
	check(t, f.request("GET", str(second["view_url"]), "", nil), 404)
	check(t, f.request("DELETE", base+"/permanent", token, nil), 204)
	files, err := os.ReadDir(filepath.Join(f.dir, "objects", "blobs"))
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 0 {
		t.Fatalf("永久删除后仍遗留 %d 个文件", len(files))
	}
}
