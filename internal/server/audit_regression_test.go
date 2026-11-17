package server

import (
	"context"
	"encoding/base64"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestGarbagePreservesSharedBookmarkImages(t *testing.T) {
	f := setup(t)
	tokens := make([]string, 2)
	ids := make([]string, 2)
	for i, name := range []string{"image_owner_a", "image_owner_b"} {
		tokens[i], _ = f.account(name)
		bookmark := data(t, f.request("POST", "/api/v1/bookmarks", tokens[i], object{"title": "共享封面", "url": "https://example.com/shared", "cover_image": "/api/bookmark-images/images/shared.png"}), 201)["bookmark"].(map[string]any)
		ids[i] = str(bookmark["id"])
		_, err := f.db.Exec(`INSERT INTO bookmark_images(id,bookmark_id,user_id,image_hash,r2_key,file_size,mime_type,original_url) SELECT ?,id,user_id,'shared.png','images/shared.png',8,'image/png','https://example.com/image.png' FROM bookmarks WHERE id=?`, name, ids[i])
		if err != nil {
			t.Fatal(err)
		}
	}
	path := filepath.Join(f.dir, "objects", "images", "shared.png")
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	content := "共享图片"
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	for i := range ids {
		base := "/api/v1/bookmarks/" + ids[i]
		check(t, f.request("DELETE", base, tokens[i], nil), 204)
		check(t, f.request("DELETE", base+"/permanent", tokens[i], nil), 204)
		if i == 0 {
			w := f.request("GET", bookmarkCover(t, f, tokens[1], ids[1]), "", nil)
			if w.Code != 200 || w.Body.String() != content {
				t.Fatalf("仍有引用的封面被删除: %d", w.Code)
			}
		} else if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("最后一次引用删除后应清理文件: %v", err)
		}
	}
	var count int
	if err := f.db.QueryRow("SELECT COUNT(*) FROM object_gc").Scan(&count); err != nil || count != 0 {
		t.Fatalf("清理队列未排空: %d %v", count, err)
	}
}

func TestBasicKeyCreatesSnapshotsWithSVG(t *testing.T) {
	f := setup(t)
	token, _ := f.account("svg_owner")
	key := data(t, f.request("POST", "/api/v1/settings/api-keys", token, object{"name": "扩展基础权限", "template": "BASIC"}), 201)
	rawKey := str(key["key"])
	bookmark := data(t, f.request("POST", "/api/tab/bookmarks", rawKey, object{"title": "SVG 网页", "url": "https://example.com/svg"}), 201)["bookmark"].(map[string]any)
	base := "/api/tab/bookmarks/" + str(bookmark["id"])
	svg := `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>`
	encoded := base64.StdEncoding.EncodeToString([]byte(svg))
	body := object{"title": "SVG 网页", "url": "https://example.com/svg", "html_content": `<html><img src="/api/snapshot-images/svg-example"></html>`, "images": []object{{"hash": "svg-example", "type": "image/svg+xml", "data": encoded[:20] + "\n " + encoded[20:]}}}
	for _, suffix := range []string{"/snapshots", "/snapshots-v2"} {
		body["html_content"] = str(body["html_content"]) + " "
		snapshot := data(t, f.request("POST", base+suffix, rawKey, body), 200)["snapshot"].(map[string]any)
		view := f.request("GET", str(snapshot["view_url"]), "", nil)
		if view.Code != 200 {
			t.Fatalf("快照不可访问: %d", view.Code)
		}
		image := f.request("GET", snapshotImageURL.FindString(view.Body.String()), "", nil)
		if image.Code != 200 || image.Body.String() != svg || image.Header().Get("Content-Type") != "image/svg+xml" || image.Header().Get("X-Content-Type-Options") != "nosniff" || !strings.Contains(image.Header().Get("Content-Security-Policy"), "sandbox") {
			t.Fatalf("SVG 响应错误: %d %+v", image.Code, image.Header())
		}
		check(t, f.request("DELETE", base+"/snapshots/"+str(snapshot["id"]), rawKey, nil), 403)
	}
	check(t, f.request("PATCH", base, rawKey, object{"title": "禁止修改"}), 403)
	readonly := data(t, f.request("POST", "/api/v1/settings/api-keys", token, object{"name": "只读", "template": "READ_ONLY"}), 201)
	check(t, f.request("POST", base+"/snapshots", str(readonly["key"]), body), 403)
	body["images"] = []object{{"hash": "fake-svg", "type": "image/svg+xml", "data": base64.StdEncoding.EncodeToString([]byte("<html>伪造图片</html>"))}}
	check(t, f.request("POST", base+"/snapshots", rawKey, body), 400)
}

func TestSnapshotSVGValidation(t *testing.T) {
	for _, input := range []string{
		`<svg xmlns="http://example.com"/>`,
		`<svg xmlns="http://www.w3.org/2000/svg"><rect></svg>`,
		`<svg xmlns="http://www.w3.org/2000/svg"/><svg xmlns="http://www.w3.org/2000/svg"/>`,
		`<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>`,
		`文本<svg xmlns="http://www.w3.org/2000/svg"/>`,
	} {
		if _, ok := snapshotImageMIME([]byte(input), "image/svg+xml"); ok {
			t.Fatalf("接受了无效 SVG: %s", input)
		}
	}
	valid := []byte(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>`)
	if mime, ok := snapshotImageMIME(valid, "image/svg+xml; charset=utf-8"); !ok || mime != "image/svg+xml" {
		t.Fatal("未接受有效的 XML SVG")
	}
}

func TestAPIKeyLogsStatusAndRetention(t *testing.T) {
	f := setup(t)
	token, _ := f.account("key_logs")
	key := data(t, f.request("POST", "/api/v1/settings/api-keys", token, object{"name": "日志检查", "template": "READ_ONLY"}), 201)
	kid, rawKey := str(key["id"]), str(key["key"])
	check(t, f.request("GET", "/api/tab/bookmarks?secret=omit", rawKey, nil), 200)
	check(t, f.request("POST", "/api/tab/bookmarks", rawKey, object{"title": "权限拒绝", "url": "https://example.com"}), 403)
	check(t, f.request("GET", "/api/tab/bookmarks/absent", rawKey, nil), 404)
	window := time.Now().Unix() / 60 * 60
	if _, err := f.db.Exec("INSERT INTO rate_limits(key,window_seconds,window_start,count,updated_at) VALUES(?,60,?,300,?) ON CONFLICT(key,window_seconds,window_start) DO UPDATE SET count=300", "key:"+kid, window, window); err != nil {
		t.Fatal(err)
	}
	check(t, f.request("GET", "/api/tab/bookmarks", rawKey, nil), 429)
	logs := data(t, f.request("GET", "/api/v1/settings/api-keys/"+kid+"/logs", token, nil), 200)["logs"].([]any)
	if len(logs) != 4 {
		t.Fatalf("日志数=%d，预期=4", len(logs))
	}
	for i, code := range []int64{429, 404, 403, 200} {
		row := logs[i].(map[string]any)
		if number(row["status"]) != code || strings.Contains(str(row["endpoint"]), "?") {
			t.Fatalf("日志状态或路径错误: %+v", row)
		}
	}
	stats := data(t, f.request("GET", "/api/v1/settings/api-keys/"+kid, token, nil), 200)["stats"].(map[string]any)
	if number(stats["total_requests"]) != 4 {
		t.Fatalf("请求统计错误: %+v", stats)
	}
	if _, err := f.db.Exec(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<110) INSERT INTO api_key_logs(api_key_id,user_id,endpoint,method,status) SELECT id,user_id,'/old','GET',200 FROM api_keys,n WHERE id=?`, kid); err != nil {
		t.Fatal(err)
	}
	check(t, f.request("GET", "/api/tab/bookmarks", rawKey, nil), 429)
	logs = data(t, f.request("GET", "/api/v1/settings/api-keys/"+kid+"/logs?limit=100", token, nil), 200)["logs"].([]any)
	if len(logs) != 100 || number(logs[0].(map[string]any)["status"]) != 429 {
		t.Fatal("没有保留最近 100 条日志")
	}
}

func TestAPIKeyLogsPanicCancellationAndWriteFailure(t *testing.T) {
	f := setup(t)
	token, _ := f.account("key_log_failure")
	key := data(t, f.request("POST", "/api/v1/settings/api-keys", token, object{"name": "日志失败", "template": "READ_ONLY"}), 201)
	s := &Server{db: f.db, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	for _, panicHandler := range []bool{true, false} {
		ctx, cancel := context.WithCancel(context.Background())
		r := httptest.NewRequest("GET", "/test", nil).WithContext(ctx)
		r.Header.Set("X-API-Key", str(key["key"]))
		w := httptest.NewRecorder()
		s.authenticate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if panicHandler {
				panic("测试异常")
			}
			cancel()
			w.WriteHeader(204)
		})).ServeHTTP(w, r)
		cancel()
		var code int
		if err := f.db.QueryRow("SELECT status FROM api_key_logs WHERE api_key_id=? ORDER BY id DESC LIMIT 1", key["id"]).Scan(&code); err != nil || code != w.Code {
			t.Fatalf("异常或取消请求日志状态不符: %d %d %v", code, w.Code, err)
		}
	}
	if _, err := f.db.Exec(`CREATE TRIGGER fail_key_log BEFORE INSERT ON api_key_logs BEGIN SELECT RAISE(ABORT,'日志不可写'); END`); err != nil {
		t.Fatal(err)
	}
	check(t, f.request("GET", "/api/tab/bookmarks", str(key["key"]), nil), 200)
}

func TestSnapshotAcceptsRepeatedImageHash(t *testing.T) {
	f := setup(t)
	token, _ := f.account("repeat_image_owner")
	bookmark := data(t, f.request("POST", "/api/v1/bookmarks", token, object{"title": "重复图片", "url": "https://example.com/repeat"}), 201)["bookmark"].(map[string]any)
	svg := base64.StdEncoding.EncodeToString([]byte(`<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>`))
	image := object{"hash": "same-image", "type": "image/svg+xml", "data": svg}
	body := object{"title": "重复图片", "url": "https://example.com/repeat", "html_content": `<img src="/api/snapshot-images/same-image"><img src="/api/snapshot-images/same-image">`, "images": []object{image, image}}
	snapshot := data(t, f.request("POST", "/api/v1/bookmarks/"+str(bookmark["id"])+"/snapshots", token, body), 200)["snapshot"].(map[string]any)
	var imageCount int
	if err := f.db.QueryRow("SELECT COUNT(*) FROM snapshot_images WHERE snapshot_id=?", str(snapshot["id"])).Scan(&imageCount); err != nil || imageCount != 1 {
		t.Fatalf("重复图片应只存储一份，实际数量=%d，错误=%v", imageCount, err)
	}
	content, _ := base64.StdEncoding.DecodeString(svg)
	if number(snapshot["file_size"]) != int64(len(str(body["html_content"]))+len(content)) {
		t.Fatal("存储用量不应重复计算相同图片")
	}
	if view := f.request("GET", str(snapshot["view_url"]), "", nil); view.Code != 200 {
		t.Fatalf("快照不可访问: %d", view.Code)
	}
	body["images"] = []object{{"hash": "bad hash", "type": "image/svg+xml", "data": svg}}
	check(t, f.request("POST", "/api/v1/bookmarks/"+str(bookmark["id"])+"/snapshots", token, body), 400)
}
