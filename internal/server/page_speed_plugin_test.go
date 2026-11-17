package server

import "testing"

func TestPageSpeedPluginLifecycle(t *testing.T) {
	f := setup(t)
	alice, _ := f.account("speed_alice")
	bob, _ := f.account("speed_bob")
	path := "/api/v1/plugins/markvault.page-speed"
	state := func(token string, enabled bool) {
		t.Helper()
		value := data(t, f.request("GET", path, token, nil), 200)
		if value["origin"] != "builtin" || value["enabled"] != enabled {
			t.Fatal("测速插件默认状态或账户隔离异常", value)
		}
		want := "disabled"
		if enabled {
			want = "running"
		}
		if value["status"] != want {
			t.Fatal("测速插件运行状态异常", value)
		}
	}
	state(alice, false)
	check(t, f.request("PUT", path, alice, object{"enabled": true, "config": object{}, "grants": []string{}}), 200)
	state(alice, true)
	state(bob, false)
	check(t, f.request("PUT", path, alice, object{"enabled": false, "config": object{}, "grants": []string{}}), 200)
	state(alice, false)
	check(t, f.request("PUT", path, alice, object{"enabled": true, "config": object{}, "grants": []string{}}), 200)
	check(t, f.request("POST", "/api/v1/plugin-admin/markvault.page-speed/disable", alice, nil), 200)
	value := data(t, f.request("GET", path, alice, nil), 200)
	if value["disabled"] != true || value["status"] == "running" {
		t.Fatal("实例停用后仍然运行")
	}
}

func TestLayoutPluginsAreOptInAndAcceptedAsPreferences(t *testing.T) {
	f := setup(t)
	alice, _ := f.account("layout_alice")
	for _, id := range []string{"view-gallery", "view-timeline", "view-domains", "view-focus", "tag-cloud", "tag-bars", "tab-board", "tab-compact"} {
		value := data(t, f.request("GET", "/api/v1/plugins/markvault."+id, alice, nil), 200)
		if value["origin"] != "builtin" || value["enabled"] != false || value["status"] != "disabled" {
			t.Fatal("布局插件应默认关闭", id, value)
		}
	}
	check(t, f.request("PUT", "/api/v1/plugins/markvault.view-gallery", alice, object{"enabled": true, "config": object{}, "grants": []string{}}), 200)
	if value := data(t, f.request("GET", "/api/v1/plugins/markvault.view-gallery", alice, nil), 200); value["status"] != "running" {
		t.Fatal("布局插件启用后未运行", value)
	}
	check(t, f.request("PATCH", "/api/v1/preferences", alice, object{"view_mode": "timeline", "tag_layout": "cloud"}), 200)
	preferences := data(t, f.request("GET", "/api/v1/preferences", alice, nil), 200)["preferences"].(map[string]any)
	if preferences["view_mode"] != "timeline" || preferences["tag_layout"] != "cloud" {
		t.Fatal("插件布局未保存到偏好", preferences["view_mode"], preferences["tag_layout"])
	}
}

func TestPageShellPluginsAreOptInThemesAndCoexist(t *testing.T) {
	f := setup(t)
	alice, _ := f.account("shell_alice")
	ids := []string{"home-topbar", "home-launchpad", "home-reader", "home-tagboard", "tabs-tabbed", "tabs-wall", "tabs-timeline"}
	for _, id := range ids {
		value := data(t, f.request("GET", "/api/v1/plugins/markvault."+id, alice, nil), 200)
		if value["origin"] != "builtin" || value["enabled"] != false || value["status"] != "disabled" {
			t.Fatal("页面版式插件应默认关闭", id, value)
		}
	}
	// 版式与界面主题互不排斥：多个版式可同时启用，也不改写已选的界面主题。
	check(t, f.request("PUT", "/api/v1/plugins/markvault.vibehub", alice, object{"enabled": true, "config": object{}, "grants": []string{}}), 200)
	for _, id := range ids {
		check(t, f.request("PUT", "/api/v1/plugins/markvault."+id, alice, object{"enabled": true, "config": object{}, "grants": []string{}}), 200)
	}
	for _, id := range ids {
		if value := data(t, f.request("GET", "/api/v1/plugins/markvault."+id, alice, nil), 200); value["status"] != "running" {
			t.Fatal("页面版式插件启用后未运行", id, value)
		}
	}
	preferences := data(t, f.request("GET", "/api/v1/preferences", alice, nil), 200)["preferences"].(map[string]any)
	if preferences["experimental_vibehub_theme_enabled"] != true {
		t.Fatal("启用页面版式不应改写界面主题", preferences["experimental_vibehub_theme_enabled"])
	}
}
