package server

import (
	"encoding/base64"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"markvault/internal/config"
)

func addPrivateImage(t *testing.T, f *fixture, token, hash string) (string, string) {
	t.Helper()
	path := "/api/bookmark-images/images/" + hash
	bookmark := data(t, f.request("POST", "/api/v1/bookmarks", token, object{"title": "私有封面", "url": "https://example.com/" + hash, "cover_image": path}), 201)["bookmark"].(map[string]any)
	bid := str(bookmark["id"])
	if _, err := f.db.Exec(`INSERT INTO bookmark_images(id,bookmark_id,user_id,image_hash,r2_key,file_size,mime_type,original_url) SELECT ?,id,user_id,?,?,7,'image/png','https://example.com/image.png' FROM bookmarks WHERE id=?`, hash, hash, "images/"+hash, bid); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(f.dir, "objects", "images", hash)
	if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte("private"), 0600); err != nil {
		t.Fatal(err)
	}
	return bid, path
}

func bookmarkCover(t *testing.T, f *fixture, token, bid string) string {
	t.Helper()
	bookmark := data(t, f.request("GET", "/api/v1/bookmarks/"+bid, token, nil), 200)["bookmark"].(map[string]any)
	return str(bookmark["cover_image"])
}

func TestBookmarkImageAccess(t *testing.T) {
	f := setup(t)
	owner, _ := f.account("image_owner")
	other, _ := f.account("image_other")
	bid, rawPath := addPrivateImage(t, f, owner, "private.png")
	link := bookmarkCover(t, f, owner, bid)

	t.Run("匿名和其他账号不能直接读取", func(t *testing.T) {
		check(t, f.request("GET", rawPath, "", nil), 401)
		check(t, f.request("GET", rawPath, other, nil), 401)
	})
	t.Run("所有者取得的短期链接正常显示", func(t *testing.T) {
		parsed, err := url.Parse(link)
		if err != nil || parsed.Query().Get("exp") == "" || parsed.Query().Get("sig") == "" {
			t.Fatalf("私有封面未返回短期签名链接: %s", link)
		}
		w := f.request("GET", link, "", nil)
		if w.Code != 200 || w.Body.String() != "private" || w.Header().Get("Cache-Control") != "private, no-store" {
			t.Fatalf("封面响应不符合访问和缓存要求: %d %+v", w.Code, w.Header())
		}
	})
	t.Run("伪造书签引用不能读取他人图片", func(t *testing.T) {
		bookmark := data(t, f.request("POST", "/api/v1/bookmarks", other, object{"title": "伪造引用", "url": "https://example.com/forged", "cover_image": rawPath}), 201)["bookmark"].(map[string]any)
		check(t, f.request("GET", str(bookmark["cover_image"]), "", nil), 404)
	})
	t.Run("修改签名参数被拒绝", func(t *testing.T) {
		for key, value := range map[string]string{"u": "another-user", "b": "another-bookmark", "scope": "public", "exp": "9999999999"} {
			parsed, _ := url.Parse(link)
			q := parsed.Query()
			q.Set(key, value)
			parsed.RawQuery = q.Encode()
			check(t, f.request("GET", parsed.String(), "", nil), 401)
		}
	})
	t.Run("编辑和导出不保存临时签名", func(t *testing.T) {
		check(t, f.request("PATCH", "/api/v1/bookmarks/"+bid, owner, object{"cover_image": link}), 200)
		var stored string
		if err := f.db.QueryRow("SELECT cover_image FROM bookmarks WHERE id=?", bid).Scan(&stored); err != nil || stored != rawPath {
			t.Fatalf("临时签名被持久化: %q %v", stored, err)
		}
		exported := check(t, f.request("GET", "/api/v1/export?scope=bookmarks", owner, nil), 200)
		if str(exported["bookmarks"].([]any)[0].(map[string]any)["cover_image"]) != rawPath {
			t.Fatal("导出包含临时签名")
		}
	})
	t.Run("删除书签立即撤销图片访问", func(t *testing.T) {
		check(t, f.request("DELETE", "/api/v1/bookmarks/"+bid, owner, nil), 204)
		check(t, f.request("GET", link, "", nil), 404)
	})
}

func TestPublicBookmarkImageRevocation(t *testing.T) {
	f := setup(t)
	owner, _ := f.account("public_image_owner")
	bid, _ := addPrivateImage(t, f, owner, "public.png")
	check(t, f.request("PATCH", "/api/v1/bookmarks/"+bid, owner, object{"is_public": true}), 200)
	check(t, f.request("PUT", "/api/v1/settings/share", owner, object{"enabled": true, "slug": "public-images"}), 200)
	public := data(t, f.request("GET", "/api/public/public-images", "", nil), 200)
	link := str(public["bookmarks"].([]any)[0].(map[string]any)["cover_image"])
	if w := f.request("GET", link, "", nil); w.Code != 200 || w.Body.String() != "private" {
		t.Fatalf("公开封面不可访问: %d", w.Code)
	}
	check(t, f.request("PUT", "/api/v1/settings/share", owner, object{"enabled": false}), 200)
	check(t, f.request("GET", link, "", nil), 404)
	check(t, f.request("PUT", "/api/v1/settings/share", owner, object{"enabled": true}), 200)
	check(t, f.request("PATCH", "/api/v1/bookmarks/"+bid, owner, object{"is_public": false}), 200)
	check(t, f.request("GET", link, "", nil), 404)
	if w := f.request("GET", bookmarkCover(t, f, owner, bid), "", nil); w.Code != 200 {
		t.Fatalf("关闭分享后所有者无法查看封面: %d", w.Code)
	}
}

func TestSnapshotImageSignatureScope(t *testing.T) {
	f := setup(t)
	token, _ := f.account("snapshot_signing")
	bookmark := data(t, f.request("POST", "/api/v1/bookmarks", token, object{"title": "快照签名", "url": "https://example.com/snapshot"}), 201)["bookmark"].(map[string]any)
	base := "/api/v1/bookmarks/" + str(bookmark["id"]) + "/snapshots"
	var imageLink string
	for _, version := range []string{"one", "two"} {
		svg := `<svg xmlns="http://www.w3.org/2000/svg"><title>` + version + `</title></svg>`
		body := object{"title": version, "url": "https://example.com/snapshot", "html_content": `<img src="/api/snapshot-images/same-hash">` + version, "images": []object{{"hash": "same-hash", "type": "image/svg+xml", "data": base64.StdEncoding.EncodeToString([]byte(svg))}}}
		snapshot := data(t, f.request("POST", base, token, body), 200)["snapshot"].(map[string]any)
		view := f.request("GET", str(snapshot["view_url"]), "", nil)
		if view.Code != 200 {
			t.Fatalf("快照不可访问: %d", view.Code)
		}
		link := snapshotImageURL.FindString(view.Body.String())
		if w := f.request("GET", link, "", nil); w.Code != 200 || w.Body.String() != svg {
			t.Fatalf("快照图片版本不正确: %d %s", w.Code, w.Body.String())
		}
		if version == "one" {
			imageLink = link
		}
	}
	t.Run("不能改写版本或身份", func(t *testing.T) {
		for key, value := range map[string]string{"v": "2", "s": "another-snapshot", "u": "another-user", "b": "another-bookmark", "exp": "9999999999"} {
			parsed, _ := url.Parse(imageLink)
			q := parsed.Query()
			q.Set(key, value)
			parsed.RawQuery = q.Encode()
			check(t, f.request("GET", parsed.String(), "", nil), 401)
		}
	})
	t.Run("图片继承快照链接的有效期", func(t *testing.T) {
		parsed, _ := url.Parse(imageLink)
		exp := parsed.Query().Get("exp")
		if exp == "" {
			t.Fatal("图片签名没有有效期")
		}
		w := f.request("GET", imageLink, "", nil)
		if w.Header().Get("Cache-Control") != "private, no-store" {
			t.Fatal("图片缓存可能延长链接有效期")
		}
	})
	t.Run("拒绝有效签名的过期链接", func(t *testing.T) {
		parsed, _ := url.Parse(imageLink)
		q := parsed.Query()
		q.Set("exp", stringInt(time.Now().Add(-time.Minute).Unix()))
		s := &Server{config: config.Config{JWTSecret: strings.Repeat("s", 64)}}
		q.Set("sig", s.signature("snapshot-image:same-hash:"+q.Get("u")+":"+q.Get("b")+":"+q.Get("s")+":"+q.Get("v")+":"+q.Get("exp")))
		parsed.RawQuery = q.Encode()
		check(t, f.request("GET", parsed.String(), "", nil), 401)
	})
}
