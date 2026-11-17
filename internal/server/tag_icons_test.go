package server

import (
	"strings"
	"testing"
)

const testTagPNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0e8AAAAASUVORK5CYII="

func TestTagIconValidation(t *testing.T) {
	for _, value := range []any{nil, "none", "brand:github", "brand:docker", "icon:book", "https://example.com/logo.svg", "http://localhost/icon.png", testTagPNG} {
		if !validTagIcon(value) {
			t.Errorf("拒绝了有效图标: %v", value)
		}
	}
	for _, value := range []any{"", 1, false, object{}, "brand:missing", "icon:missing", "javascript:alert(1)", "file:///logo.png", "//example.com/logo.png", "https://name:pass@example.com/logo.png", "data:image/svg+xml;base64,PHN2Zz4=", "data:image/png;base64,aGVsbG8=", "data:image/jpeg;base64," + strings.TrimPrefix(testTagPNG, "data:image/png;base64,"), "data:image/png;base64,!!", "data:image/png;base64," + strings.Repeat("A", 87384), "https://example.com/" + strings.Repeat("a", 2048)} {
		if validTagIcon(value) {
			t.Errorf("接受了无效图标: %.80v", value)
		}
	}
}

func TestTagIconsAndPreferenceIsolation(t *testing.T) {
	f := setup(t)
	owner, _ := f.account("icons_owner")
	other, _ := f.account("icons_other")
	tag := data(t, f.request("POST", "/api/v1/tags", owner, object{"name": "GitHub", "icon": "brand:docker"}), 201)["tag"].(map[string]any)
	tid := str(tag["id"])
	if tag["icon"] != "brand:docker" {
		t.Fatal("创建时未保存图标")
	}
	check(t, f.request("PATCH", "/api/v1/tags/"+tid, other, object{"icon": "icon:book"}), 404)
	for _, icon := range []any{"icon:book", testTagPNG, "https://example.com/icon.svg", nil, "none"} {
		updated := data(t, f.request("PATCH", "/api/v1/tags/"+tid, owner, object{"icon": icon}), 200)["tag"].(map[string]any)
		if updated["icon"] != icon {
			t.Fatal("图标更新或重置失败")
		}
	}
	check(t, f.request("PATCH", "/api/v1/tags/"+tid, owner, object{"name": "不能保存", "icon": "javascript:alert(1)"}), 400)
	rows := data(t, f.request("GET", "/api/v1/tags", owner, nil), 200)["tags"].([]any)
	saved := rows[0].(map[string]any)
	if saved["name"] != "GitHub" || saved["icon"] != "none" {
		t.Fatal("无效更新部分写入了标签")
	}
	if len(data(t, f.request("GET", "/api/v1/tags", other, nil), 200)["tags"].([]any)) != 0 {
		t.Fatal("图标泄漏给其他用户")
	}

	defaults := data(t, f.request("GET", "/api/v1/preferences", owner, nil), 200)["preferences"].(map[string]any)
	if defaults["show_tag_icons"] != true {
		t.Fatal("默认应显示标签图标")
	}
	check(t, f.request("PATCH", "/api/v1/preferences", owner, object{"show_tag_icons": false}), 200)
	check(t, f.request("PATCH", "/api/v1/preferences", owner, object{"show_tag_icons": 1}), 400)
	prefs := data(t, f.request("GET", "/api/v1/preferences", owner, nil), 200)["preferences"].(map[string]any)
	otherPrefs := data(t, f.request("GET", "/api/v1/preferences", other, nil), 200)["preferences"].(map[string]any)
	if prefs["show_tag_icons"] != false || otherPrefs["show_tag_icons"] != true {
		t.Fatal("图标开关未持久化或未隔离用户")
	}
}

func TestTagIconBackupRoundTrip(t *testing.T) {
	f := setup(t)
	owner, _ := f.account("icon_backup")
	other, _ := f.account("icon_restore")
	data(t, f.request("POST", "/api/v1/tags", owner, object{"name": "Docker", "icon": testTagPNG}), 201)
	backup := check(t, f.request("GET", "/api/v1/export", owner, nil), 200)
	if backup["tags"].([]any)[0].(map[string]any)["icon"] != testTagPNG {
		t.Fatal("备份遗漏自定义图标")
	}
	data(t, f.request("POST", "/api/v1/import", other, backup), 200)
	tags := data(t, f.request("GET", "/api/v1/tags", other, nil), 200)["tags"].([]any)
	if len(tags) != 1 || tags[0].(map[string]any)["icon"] != testTagPNG {
		t.Fatal("还原遗漏自定义图标")
	}
	// 旧格式未带图标时保留已有配置。
	old := object{"format": "tmarks", "version": "1.0.0", "tags": []object{{"name": "Docker", "color": "#3b82f6"}}, "bookmarks": []object{}}
	data(t, f.request("POST", "/api/v1/import", other, old), 200)
	tags = data(t, f.request("GET", "/api/v1/tags", other, nil), 200)["tags"].([]any)
	if tags[0].(map[string]any)["icon"] != testTagPNG {
		t.Fatal("旧备份清除了已有图标")
	}
}

func TestPublicTagIconsRespectVisibility(t *testing.T) {
	f := setup(t)
	owner, _ := f.account("icon_public")
	publicTag := data(t, f.request("POST", "/api/v1/tags", owner, object{"name": "GitHub", "icon": "brand:github"}), 201)["tag"].(map[string]any)
	privateTag := data(t, f.request("POST", "/api/v1/tags", owner, object{"name": "私有", "icon": testTagPNG}), 201)["tag"].(map[string]any)
	data(t, f.request("POST", "/api/v1/bookmarks", owner, object{"title": "公开", "url": "https://example.com/public", "is_public": true, "tag_ids": []string{str(publicTag["id"])}}), 201)
	data(t, f.request("POST", "/api/v1/bookmarks", owner, object{"title": "私有", "url": "https://example.com/private", "tag_ids": []string{str(privateTag["id"])}}), 201)
	check(t, f.request("PATCH", "/api/v1/preferences", owner, object{"show_tag_icons": false}), 200)
	share := data(t, f.request("PUT", "/api/v1/settings/share", owner, object{"enabled": true}), 200)["share"].(map[string]any)
	result := data(t, f.request("GET", "/api/public/"+str(share["slug"]), "", nil), 200)
	tags := result["tags"].([]any)
	if len(tags) != 1 || tags[0].(map[string]any)["icon"] != "brand:github" {
		t.Fatal("公开页遗漏图标或暴露了私有标签")
	}
	if result["preferences"].(map[string]any)["show_tag_icons"] != false {
		t.Fatal("公开页未应用发布者的图标开关")
	}
}
