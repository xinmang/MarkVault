package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"markvault/internal/plugin"
)

func TestImageHostingPurposesFallbackAndAccess(t *testing.T) {
	content, encoded := pngData(t, 4, 3)
	var uploads, downloads atomic.Int32
	var fail atomic.Bool
	var mu sync.Mutex
	files := map[string][]byte{}
	var upstream *httptest.Server
	upstream = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" {
			if fail.Load() {
				w.WriteHeader(503)
				return
			}
			if r.Header.Get("Authorization") != "Bearer image-secret" {
				t.Error("上传凭据错误")
			}
			file, header, err := r.FormFile("image")
			if err != nil {
				t.Error(err)
				w.WriteHeader(400)
				return
			}
			defer file.Close()
			if header.Header.Get("Content-Type") != "image/png" {
				t.Error("上传 MIME 错误")
			}
			raw, _ := io.ReadAll(file)
			path := fmt.Sprintf("/image/%d.png", uploads.Add(1))
			mu.Lock()
			files[path] = raw
			mu.Unlock()
			_ = json.NewEncoder(w).Encode(object{"data": []object{{"url": upstream.URL + path}}})
			return
		}
		if r.Header.Get("Authorization") != "" {
			t.Error("读取图片泄漏上传凭据")
		}
		downloads.Add(1)
		mu.Lock()
		raw, ok := files[r.URL.Path]
		mu.Unlock()
		if r.URL.Path == "/original.png" {
			raw, ok = content, true
		}
		if !ok {
			w.WriteHeader(404)
			return
		}
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(raw)
	}))
	defer upstream.Close()
	f := setup(t)
	s := f.handler.(*Server)
	s.imageClient = func(string) *http.Client { return upstream.Client() }
	token, login := f.account("image_owner")
	other, _ := f.account("image_other")
	uid := str(login["user"].(map[string]any)["id"])
	config := object{"endpoint": upstream.URL + "/upload", "fileField": "image", "urlPath": "data.0.url", "authHeader": "Authorization", "purposes": []string{"screenshot"}}
	save := func(enabled bool, purposes []string, secret string) {
		t.Helper()
		config["purposes"] = purposes
		check(t, f.request("PUT", "/api/v1/plugins/image-hosting/settings", token, object{"enabled": enabled, "granted": true, "config": config, "secret": secret}), 200)
	}
	bookmark := data(t, f.request("POST", "/api/v1/bookmarks", token, object{"title": "图床验收", "url": "https://example.com/image-host"}), 201)["bookmark"].(map[string]any)
	bid := str(bookmark["id"])
	shotPath := "/api/v1/bookmarks/" + bid + "/screenshots"
	data(t, f.request("POST", shotPath, token, object{"image": encoded}), 200)
	if uploads.Load() != 0 {
		t.Fatal("默认状态自动外传图片")
	}
	check(t, f.request("PUT", "/api/v1/plugins/image-hosting/settings", token, object{"enabled": true, "config": config, "granted": false}), 400)
	save(true, []string{"screenshot"}, "Bearer image-secret")
	var cipher string
	if err := f.db.QueryRow("SELECT ciphertext FROM plugin_credentials WHERE user_id=? AND plugin_id=?", uid, plugin.ImageHostingID).Scan(&cipher); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(cipher, "v1.") || strings.Contains(cipher, "image-secret") {
		t.Fatal("图床密钥未加密")
	}
	settings := data(t, f.request("GET", "/api/v1/plugins/image-hosting/settings", token, nil), 200)
	if settings["hasSecret"] != true || strings.Contains(mustJSON(settings), "image-secret") {
		t.Fatal("凭据读回错误")
	}
	shot := data(t, f.request("POST", shotPath, token, object{"image": encoded}), 200)["screenshot"].(map[string]any)
	key := screenshotKey(t, f, str(shot["id"]))
	if uploads.Load() != 1 || objectExists(f, key) {
		t.Fatal("截图未转存到图床")
	}
	link := str(shot["url"])
	resp := f.request("GET", link, "", nil)
	if resp.Code != 200 || !bytes.Equal(resp.Body.Bytes(), content) {
		t.Fatal("签名代理未返回图片")
	}
	before := downloads.Load()
	check(t, f.request("GET", strings.Replace(link, "sig=", "sig=bad", 1), "", nil), 401)
	check(t, f.request("POST", shotPath, other, object{"image": encoded}), 404)
	if downloads.Load() != before || uploads.Load() != 1 {
		t.Fatal("越权请求访问了图床")
	}
	snapshot := object{"title": "快照", "url": "https://example.com/image-host", "html_content": `<img src="/api/snapshot-images/test-image">`, "images": []object{{"hash": "test-image", "type": "image/png", "data": encoded}}}
	snapshotPath := "/api/v1/bookmarks/" + bid + "/snapshots"
	data(t, f.request("POST", snapshotPath, token, snapshot), 200)
	if uploads.Load() != 1 {
		t.Fatal("未选中的快照图片被上传")
	}
	save(true, []string{"screenshot", "snapshot", "cover", "favicon", "default"}, "")
	snapshot["force"] = true
	snap := data(t, f.request("POST", snapshotPath, token, snapshot), 200)["snapshot"].(map[string]any)
	view := f.request("GET", str(snap["view_url"]), "", nil)
	if view.Code != 200 || view.Header().Get("Content-Security-Policy") != snapshotCSP || strings.Contains(view.Body.String(), upstream.URL) {
		t.Fatal("快照沙箱或地址隔离失效")
	}
	imageURL := regexp.MustCompile(`/api/snapshot-images/[^"<> ]+`).FindString(view.Body.String())
	if got := f.request("GET", imageURL, "", nil); got.Code != 200 || !bytes.Equal(got.Body.Bytes(), content) {
		t.Fatal("快照图床图片读取失败")
	}
	data(t, f.request("PATCH", "/api/v1/bookmarks/"+bid, token, object{"cover_image": upstream.URL + "/original.png", "favicon": upstream.URL + "/original.png"}), 200)
	savedBookmark := data(t, f.request("GET", "/api/v1/bookmarks/"+bid, token, nil), 200)["bookmark"].(map[string]any)
	for _, field := range []string{"cover_image", "favicon"} {
		if !strings.HasPrefix(str(savedBookmark[field]), bookmarkImagePrefix) {
			t.Fatal("封面或图标没有转存")
		}
		if got := f.request("GET", str(savedBookmark[field]), "", nil); got.Code != 200 {
			t.Fatal("封面或图标不可读")
		}
	}
	oldIcon := str(savedBookmark["favicon"])
	data(t, f.request("PATCH", "/api/v1/bookmarks/"+bid, token, object{"favicon": nil}), 200)
	check(t, f.request("GET", oldIcon, "", nil), 404)
	var remainingImages int
	if err := f.db.QueryRow("SELECT COUNT(*) FROM bookmark_images WHERE bookmark_id=?", bid).Scan(&remainingImages); err != nil || remainingImages != 1 {
		t.Fatal("旧图标引用未回收")
	}
	check(t, f.request("POST", "/api/v1/plugins/image-hosting/default-image", token, object{"image": encoded}), 200)
	directory := data(t, f.request("GET", "/api/v1/plugins", token, nil), 200)
	defaultURL := str(directory["defaultBookmarkImage"])
	if defaultURL == "" || f.request("GET", defaultURL, "", nil).Code != 200 {
		t.Fatal("默认图不可用")
	}
	otherDirectory := data(t, f.request("GET", "/api/v1/plugins", other, nil), 200)
	if str(otherDirectory["defaultBookmarkImage"]) != "" {
		t.Fatal("默认图跨账号泄漏")
	}
	check(t, f.request("DELETE", "/api/v1/plugins/image-hosting/default-image", token, nil), 200)
	check(t, f.request("GET", defaultURL, "", nil), 404)
	fail.Store(true)
	fallback := data(t, f.request("POST", shotPath, token, object{"image": encoded}), 200)["screenshot"].(map[string]any)
	if !objectExists(f, screenshotKey(t, f, str(fallback["id"]))) {
		t.Fatal("上传失败没有保留本地图片")
	}
	if got := f.request("GET", str(fallback["url"]), "", nil); got.Code != 200 {
		t.Fatal("本地回退不可读")
	}
	detail := data(t, f.request("GET", "/api/v1/plugins/"+plugin.ImageHostingID, token, nil), 200)
	if str(detail["lastError"]) == "" {
		t.Fatal("上传失败没有可见状态")
	}
	save(false, []string{"screenshot"}, "")
	beforeUploads := uploads.Load()
	data(t, f.request("POST", shotPath, token, object{"image": encoded}), 200)
	if uploads.Load() != beforeUploads {
		t.Fatal("停用插件后仍然上传")
	}
	// 停用只影响新上传，已保存的图床图片仍能读取。
	if got := f.request("GET", str(savedBookmark["cover_image"]), "", nil); got.Code != 200 {
		t.Fatal("停用破坏已有图片")
	}
	check(t, f.request("DELETE", "/api/v1/bookmarks/"+bid, token, nil), 204)
	check(t, f.request("GET", str(savedBookmark["cover_image"]), "", nil), 404)
	check(t, f.request("DELETE", "/api/v1/bookmarks/"+bid+"/permanent", token, nil), 204)
	var count int
	if err := f.db.QueryRow("SELECT COUNT(*) FROM image_host_objects WHERE user_id=?", uid).Scan(&count); err != nil || count != 0 {
		t.Fatalf("图床引用未清理: %d %v", count, err)
	}
}

func TestImageHostingSettingsBoundaries(t *testing.T) {
	f := setup(t)
	token, _ := f.account("image_settings")
	cfg := object{"endpoint": "https://upload.example/api", "purposes": []string{"screenshot"}}
	save := func(config object, extra object) *httptest.ResponseRecorder {
		input := object{"enabled": true, "granted": true, "config": config}
		for k, v := range extra {
			input[k] = v
		}
		return f.request("PUT", "/api/v1/plugins/image-hosting/settings", token, input)
	}
	check(t, save(cfg, object{"secret": "Bearer private-value"}), 200)
	for _, patch := range []object{
		{"endpoint": "http://example.com"}, {"endpoint": "https://user:secret@example.com"}, {"endpoint": "https://example.com/?token=secret"},
		{"fileField": "file\r\nInjected"}, {"authHeader": "Cookie"}, {"urlPath": "data..url"}, {"purposes": []string{"unknown"}}, {"secret": "plaintext"},
	} {
		bad := object{}
		for k, v := range cfg {
			bad[k] = v
		}
		for k, v := range patch {
			bad[k] = v
		}
		check(t, save(bad, nil), 400)
	}
	// 新地址不能继承旧图床凭据。
	cfg["endpoint"] = "https://another.example/upload"
	check(t, save(cfg, nil), 200)
	result := data(t, f.request("GET", "/api/v1/plugins/image-hosting/settings", token, nil), 200)
	if result["hasSecret"] != false {
		t.Fatal("切换图床后保留旧来源凭据")
	}
	key := str(data(t, f.request("POST", "/api/v1/settings/api-keys", token, object{"name": "插件不可改", "template": "FULL"}), 201)["key"])
	check(t, f.request("PUT", "/api/v1/plugins/image-hosting/settings", key, object{}), 403)
	s := f.handler.(*Server)
	ctx := t.Context()
	// 生产网络策略不能通过图床地址访问环回、私网或非 HTTPS 资源。
	for _, address := range []string{"http://example.com/image.png", "https://127.0.0.1/image.png", "https://[::1]/image.png"} {
		if _, _, err := s.fetchHostingImage(ctx, address); err == nil {
			t.Fatalf("允许受限图片地址 %s", address)
		}
	}
	u, _ := url.Parse("https://example.com/image.png")
	if err := pluginTarget(u); err != nil {
		t.Fatal(err)
	}
}
