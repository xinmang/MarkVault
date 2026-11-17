package server

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"markvault/internal/config"
)

func pngData(t *testing.T, width, height int) ([]byte, string) {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for x := range width {
		for y := range height {
			img.Set(x, y, color.RGBA{uint8(x * 40), uint8(y * 60), 200, 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes(), "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
}

// noisyPNG 生成几乎无法压缩的图片，用于稳定地超过配额。
func noisyPNG(t *testing.T, width, height int) string {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	seed := uint32(2463534242)
	for i := range img.Pix {
		seed ^= seed << 13
		seed ^= seed >> 17
		seed ^= seed << 5
		img.Pix[i] = byte(seed)
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
}

func screenshotOf(t *testing.T, bookmark any) map[string]any {
	t.Helper()
	shot, _ := bookmark.(map[string]any)["screenshot"].(map[string]any)
	return shot
}

func screenshotFiles(t *testing.T, f *fixture) int {
	t.Helper()
	var count int
	if err := f.db.QueryRow("SELECT COUNT(*) FROM bookmark_screenshots").Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func objectExists(f *fixture, key string) bool {
	_, err := os.Stat(filepath.Join(f.dir, "objects", filepath.FromSlash(key)))
	return err == nil
}

func screenshotKey(t *testing.T, f *fixture, sid string) string {
	t.Helper()
	var key string
	if err := f.db.QueryRow("SELECT r2_key FROM bookmark_screenshots WHERE id=?", sid).Scan(&key); err != nil {
		t.Fatal(err)
	}
	return key
}

func TestScreenshotUploadReplaceAndAccess(t *testing.T) {
	f := setup(t)
	token, _ := f.account("shot_owner")
	other, _ := f.account("shot_other")
	key := str(data(t, f.request("POST", "/api/v1/settings/api-keys", token, object{"name": "扩展基础权限", "template": "BASIC"}), 201)["key"])
	bookmark := data(t, f.request("POST", "/api/tab/bookmarks", key, object{"title": "帖子", "url": "https://linux.do/t/topic/1"}), 201)["bookmark"].(map[string]any)
	bid := str(bookmark["id"])
	base := "/api/tab/bookmarks/" + bid + "/screenshots"
	content, image := pngData(t, 4, 3)

	uploaded := data(t, f.request("POST", base, key, object{"image": image, "source_url": "https://linux.do/t/topic/1", "width": 9999, "height": 9999}), 200)["screenshot"].(map[string]any)
	if number(uploaded["width"]) != 4 || number(uploaded["height"]) != 3 || str(uploaded["mime_type"]) != "image/png" || number(uploaded["file_size"]) != int64(len(content)) {
		t.Fatalf("截图元数据应来自图片本身: %+v", uploaded)
	}
	link := str(uploaded["url"])
	if !strings.HasPrefix(link, screenshotPrefix) {
		t.Fatalf("截图链接格式错误: %s", link)
	}

	t.Run("签名链接可直接显示且允许私有缓存", func(t *testing.T) {
		w := f.request("GET", link, "", nil)
		if w.Code != 200 || !bytes.Equal(w.Body.Bytes(), content) || w.Header().Get("Content-Type") != "image/png" || w.Header().Get("Cache-Control") != "private, max-age=3600" || !strings.Contains(w.Header().Get("Content-Security-Policy"), "sandbox") {
			t.Fatalf("截图响应错误: %d %+v", w.Code, w.Header())
		}
	})
	t.Run("列表、详情和网址检查都带截图", func(t *testing.T) {
		listed := data(t, f.request("GET", "/api/v1/bookmarks", token, nil), 200)["bookmarks"].([]any)
		if shot := screenshotOf(t, listed[0]); shot == nil || str(shot["id"]) != str(uploaded["id"]) || str(shot["url"]) == "" {
			t.Fatalf("列表缺少截图: %+v", listed[0])
		}
		detail := data(t, f.request("GET", "/api/v1/bookmarks/"+bid, token, nil), 200)["bookmark"]
		if screenshotOf(t, detail) == nil {
			t.Fatal("详情缺少截图")
		}
		checked := data(t, f.request("GET", "/api/tab/bookmarks/check-url?url="+url.QueryEscape("https://linux.do/t/topic/1"), key, nil), 200)["bookmark"]
		if screenshotOf(t, checked) == nil {
			t.Fatal("网址检查缺少截图")
		}
	})
	t.Run("修改签名参数被拒绝", func(t *testing.T) {
		for name, value := range map[string]string{"u": "another-user", "b": "another-bookmark", "scope": "public", "exp": "9999999999"} {
			parsed, _ := url.Parse(link)
			q := parsed.Query()
			q.Set(name, value)
			parsed.RawQuery = q.Encode()
			check(t, f.request("GET", parsed.String(), "", nil), 401)
		}
	})
	t.Run("其他账号不能上传或删除", func(t *testing.T) {
		check(t, f.request("POST", "/api/v1/bookmarks/"+bid+"/screenshots", other, object{"image": image}), 404)
		check(t, f.request("DELETE", "/api/v1/bookmarks/"+bid+"/screenshots", other, nil), 404)
	})
	t.Run("基础权限不能替换或删除已有截图", func(t *testing.T) {
		check(t, f.request("POST", base, key, object{"image": image}), 403)
		check(t, f.request("DELETE", base, key, nil), 403)
	})

	oldKey := screenshotKey(t, f, str(uploaded["id"]))
	_, larger := pngData(t, 6, 5)
	replaced := data(t, f.request("POST", "/api/v1/bookmarks/"+bid+"/screenshots", token, object{"image": larger}), 200)["screenshot"].(map[string]any)
	if str(replaced["id"]) == str(uploaded["id"]) || number(replaced["width"]) != 6 || screenshotFiles(t, f) != 1 {
		t.Fatalf("替换后应只保留新截图: %+v", replaced)
	}
	if objectExists(f, oldKey) {
		t.Fatal("旧截图文件没有清理")
	}
	check(t, f.request("GET", link, "", nil), 404)

	t.Run("公开页使用公开签名，撤销公开后失效", func(t *testing.T) {
		check(t, f.request("PATCH", "/api/v1/bookmarks/"+bid, token, object{"is_public": true}), 200)
		check(t, f.request("PUT", "/api/v1/settings/share", token, object{"enabled": true, "slug": "shot-owner"}), 200)
		public := data(t, f.request("GET", "/api/public/shot-owner", "", nil), 200)["bookmarks"].([]any)
		shot := screenshotOf(t, public[0])
		if shot == nil || !strings.Contains(str(shot["url"]), "scope=public") {
			t.Fatalf("公开页缺少公开截图: %+v", public[0])
		}
		if w := f.request("GET", str(shot["url"]), "", nil); w.Code != 200 {
			t.Fatalf("公开截图不可访问: %d", w.Code)
		}
		check(t, f.request("PATCH", "/api/v1/bookmarks/"+bid, token, object{"is_public": false}), 200)
		check(t, f.request("GET", str(shot["url"]), "", nil), 404)
	})
	t.Run("导出不包含临时签名", func(t *testing.T) {
		exported := check(t, f.request("GET", "/api/v1/export?scope=bookmarks", token, nil), 200)
		if _, ok := exported["bookmarks"].([]any)[0].(map[string]any)["screenshot"]; ok {
			t.Fatal("导出数据包含截图签名")
		}
	})
	t.Run("书签进入回收站后截图不可访问，彻底删除后清理文件", func(t *testing.T) {
		owned := screenshotOf(t, data(t, f.request("GET", "/api/v1/bookmarks/"+bid, token, nil), 200)["bookmark"])
		newKey := screenshotKey(t, f, str(owned["id"]))
		check(t, f.request("DELETE", "/api/v1/bookmarks/"+bid, token, nil), 204)
		check(t, f.request("GET", str(owned["url"]), "", nil), 404)
		check(t, f.request("DELETE", "/api/v1/bookmarks/"+bid+"/permanent", token, nil), 204)
		if screenshotFiles(t, f) != 0 || objectExists(f, newKey) {
			t.Fatal("彻底删除书签后截图未清理")
		}
	})
}

func TestScreenshotDelete(t *testing.T) {
	f := setup(t)
	token, _ := f.account("shot_delete")
	bid := str(data(t, f.request("POST", "/api/v1/bookmarks", token, object{"title": "帖子", "url": "https://x.com/a/status/1"}), 201)["bookmark"].(map[string]any)["id"])
	_, image := pngData(t, 2, 2)
	uploaded := data(t, f.request("POST", "/api/v1/bookmarks/"+bid+"/screenshots", token, object{"image": image}), 200)["screenshot"].(map[string]any)
	key := screenshotKey(t, f, str(uploaded["id"]))
	check(t, f.request("DELETE", "/api/v1/bookmarks/"+bid+"/screenshots", token, nil), 200)
	check(t, f.request("DELETE", "/api/v1/bookmarks/"+bid+"/screenshots", token, nil), 404)
	if objectExists(f, key) {
		t.Fatal("删除截图后文件仍在")
	}
	detail := data(t, f.request("GET", "/api/v1/bookmarks/"+bid, token, nil), 200)["bookmark"].(map[string]any)
	if value, ok := detail["screenshot"]; !ok || value != nil {
		t.Fatalf("没有截图时应返回 null: %+v", detail["screenshot"])
	}
}

func TestScreenshotValidationAndQuota(t *testing.T) {
	f := setupConfig(t, func(cfg *config.Config) { cfg.StorageLimit = 4096 })
	token, _ := f.account("shot_limits")
	bid := str(data(t, f.request("POST", "/api/v1/bookmarks", token, object{"title": "帖子", "url": "https://example.com/post"}), 201)["bookmark"].(map[string]any)["id"])
	path := "/api/v1/bookmarks/" + bid + "/screenshots"
	svg := base64.StdEncoding.EncodeToString([]byte(`<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>`))
	gif := base64.StdEncoding.EncodeToString([]byte("GIF89a\x01\x00\x01\x00\x00\x00\x00;"))
	hugeWebP := append([]byte("RIFF\x00\x00\x00\x00WEBPVP8X\x0a\x00\x00\x00\x00\x00\x00\x00"), 0xff, 0xff, 0x00, 0xff, 0xff, 0x00)
	small, image := pngData(t, 2, 2)
	for name, body := range map[string]object{
		"非 Base64":    {"image": "data:image/png;base64,***"},
		"非 Base64 编码": {"image": "data:image/png," + svg},
		"SVG":         {"image": "data:image/svg+xml;base64," + svg},
		"GIF":         {"image": "data:image/gif;base64," + gif},
		"尺寸超限":        {"image": "data:image/webp;base64," + base64.StdEncoding.EncodeToString(hugeWebP)},
		"来源网址无效":      {"image": image, "source_url": "javascript:alert(1)"},
	} {
		t.Run(name, func(t *testing.T) { check(t, f.request("POST", path, token, body), 400) })
	}
	big := make([]byte, 8<<20+1024)
	copy(big, "\x89PNG\r\n\x1a\n")
	check(t, f.request("POST", path, token, object{"image": base64.StdEncoding.EncodeToString(big)}), 413)

	check(t, f.request("POST", path, token, object{"image": image}), 200)
	quota := data(t, f.request("GET", "/api/v1/settings/storage", token, nil), 200)["quota"].(map[string]any)
	if number(quota["used_bytes"]) != int64(len(small)) {
		t.Fatalf("存储用量未计入截图: %+v", quota)
	}
	// 替换时旧截图的空间可以复用；超过剩余配额的新截图被拒绝且不留下文件。
	check(t, f.request("POST", path, token, object{"image": image}), 200)
	check(t, f.request("POST", path, token, object{"image": noisyPNG(t, 48, 48)}), 413)
	entries, err := os.ReadDir(filepath.Join(f.dir, "objects", "blobs"))
	if err != nil || len(entries) != 1 {
		t.Fatalf("配额拒绝后不应遗留文件: %d %v", len(entries), err)
	}
}

func TestWebPSize(t *testing.T) {
	lossy := []byte("RIFF\x00\x00\x00\x00WEBPVP8 \x00\x00\x00\x00\x00\x00\x00\x9d\x01\x2a")
	lossy = append(lossy, 0xa0, 0x05, 0x28, 0x0a) // 1440 × 2600
	lossless := []byte("RIFF\x00\x00\x00\x00WEBPVP8L\x00\x00\x00\x00\x2f")
	bits := uint32(719) | uint32(1299)<<14 // 720 × 1300
	lossless = append(lossless, byte(bits), byte(bits>>8), byte(bits>>16), byte(bits>>24))
	extended := append([]byte("RIFF\x00\x00\x00\x00WEBPVP8X\x0a\x00\x00\x00\x10\x00\x00\x00"), 0x9f, 0x05, 0x00, 0x27, 0x0a, 0x00) // 1440 × 2600
	for name, tc := range map[string]struct {
		data          []byte
		width, height int
	}{"有损": {lossy, 1440, 2600}, "无损": {lossless, 720, 1300}, "扩展": {extended, 1440, 2600}} {
		mime, width, height, ok := screenshotImageInfo(tc.data)
		if !ok || mime != "image/webp" || width != tc.width || height != tc.height {
			t.Fatalf("%s WebP 尺寸解析错误: %s %d×%d %v", name, mime, width, height, ok)
		}
	}
	if _, _, _, ok := screenshotImageInfo([]byte("RIFF\x00\x00\x00\x00WEBPVP8 \x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00")); ok {
		t.Fatal("缺少 VP8 起始码的数据应被拒绝")
	}
}
