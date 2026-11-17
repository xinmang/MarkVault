package server

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"net/netip"
	"testing"

	"markvault/internal/plugin"
)

func pluginZip(t *testing.T, version string, permissions []string, settings object) []byte {
	t.Helper()
	m := plugin.Manifest{ID: "example.test", Version: version, API: "^1.0.0", Name: "测试", Author: "测试", Permissions: permissions, Settings: settings, Contributes: []plugin.Contribution{{ID: "theme", Kind: "theme", Title: "主题", Tokens: map[string]string{"--primary": "#123456"}}}}
	raw, _ := json.Marshal(m)
	var b bytes.Buffer
	z := zip.NewWriter(&b)
	w, _ := z.Create("manifest.json")
	_, _ = w.Write(raw)
	_ = z.Close()
	return b.Bytes()
}
func (f *fixture) installPlugin(token string, raw []byte) *httptest.ResponseRecorder {
	r := httptest.NewRequest("POST", "/api/v1/plugin-admin/install", bytes.NewReader(raw))
	r.Header.Set("Authorization", "Bearer "+token)
	r.Header.Set("Content-Type", "application/zip")
	w := httptest.NewRecorder()
	f.handler.ServeHTTP(w, r)
	return w
}
func TestPluginInstallAuthorizationIsolationAndRollback(t *testing.T) {
	f := setup(t)
	alice, a := f.account("alice")
	bob, _ := f.account("bobby")
	uid := str(a["user"].(map[string]any)["id"])
	raw := pluginZip(t, "1.0.0", []string{"storage.read", "storage.write"}, nil)
	check(t, f.installPlugin(bob, raw), 403)
	check(t, f.installPlugin(alice, raw), 200)
	st := data(t, f.request("GET", "/api/v1/plugins/example.test", alice, nil), 200)
	if st["enabled"] != false {
		t.Fatal("安装后自动启用")
	}
	check(t, f.request("PUT", "/api/v1/plugins/example.test", alice, object{"enabled": true, "config": object{}, "grants": []string{}}), 400)
	saved := data(t, f.request("PUT", "/api/v1/plugins/example.test", alice, object{"enabled": true, "config": object{}, "grants": []string{"storage.read", "storage.write"}}), 200)
	rpc := func(token, revision, method string, args object) *httptest.ResponseRecorder {
		return f.request("POST", "/api/v1/plugins/example.test/rpc", token, object{"revision": revision, "method": method, "args": args})
	}
	check(t, rpc(alice, str(saved["revision"]), "storage.set", object{"key": "secret-note", "value": "alice-only"}), 200)
	check(t, rpc(bob, str(saved["revision"]), "storage.get", object{"key": "secret-note"}), 409)
	other := data(t, f.request("PUT", "/api/v1/plugins/example.test", bob, object{"enabled": true, "config": object{}, "grants": []string{"storage.read", "storage.write"}}), 200)
	read := data(t, rpc(bob, str(other["revision"]), "storage.get", object{"key": "secret-note"}), 200)
	if read["value"] != nil {
		t.Fatal("跨账号存储泄漏")
	}
	check(t, f.installPlugin(alice, pluginZip(t, "1.0.1", []string{"storage.read", "storage.write", "network.fetch"}, nil)), 200)
	upgraded := data(t, f.request("GET", "/api/v1/plugins/example.test", alice, nil), 200)
	if upgraded["status"] != "pending-authorization" {
		t.Fatal("升级新增权限未等待授权")
	}
	check(t, rpc(alice, str(saved["revision"]), "storage.get", object{"key": "secret-note"}), 409)
	check(t, f.request("POST", "/api/v1/plugin-admin/example.test/rollback", alice, nil), 200)
	rolled := data(t, f.request("GET", "/api/v1/plugins/example.test", alice, nil), 200)
	if rolled["manifest"].(map[string]any)["version"] != "1.0.0" {
		t.Fatal("未回滚")
	}
	invalid := object{"type": "object", "properties": object{"requiredValue": object{"type": "string"}}, "required": []any{"requiredValue"}}
	check(t, f.installPlugin(alice, pluginZip(t, "1.0.2", []string{"storage.read"}, invalid)), 400)
	check(t, f.request("POST", "/api/v1/plugin-admin/example.test/disable", alice, nil), 200)
	check(t, rpc(bob, str(other["revision"]), "storage.get", object{"key": "secret-note"}), 409)
	check(t, f.request("POST", "/api/v1/plugin-admin/example.test/uninstall", alice, nil), 200)
	var count int
	if err := f.db.QueryRow("SELECT COUNT(*) FROM plugin_storage WHERE user_id=?", uid).Scan(&count); err != nil || count != 1 {
		t.Fatal("卸载不应清除用户数据")
	}
}
func TestBuiltinPluginDisableAndCatalog(t *testing.T) {
	f := setup(t)
	token, _ := f.account("alice")
	check(t, f.request("PUT", "/api/v1/plugins/markvault.agent", token, object{"enabled": false, "config": object{}, "grants": []string{}}), 200)
	check(t, f.request("POST", "/api/v1/agent/chat", token, object{"messages": []object{{"role": "user", "content": "hi"}}}), 409)
	catalog := data(t, f.request("GET", "/api/v1/plugins/catalog", token, nil), 200)
	if len(catalog["entries"].([]any)) != 3 {
		t.Fatal("离线目录不完整")
	}
	check(t, f.request("GET", "/api/v1/plugins", "", nil), 401)
}
func TestPluginNetworkTargets(t *testing.T) {
	for _, ip := range []string{"127.0.0.1", "::1", "::ffff:127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.0.1", "192.0.2.1"} {
		if pluginPublicIP(netip.MustParseAddr(ip)) {
			t.Fatal("允许非公网地址", ip)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	client := pluginHTTPClient()
	req := httptest.NewRequest("GET", "https://127.0.0.1/", nil).WithContext(ctx)
	req.RequestURI = ""
	if _, err := client.Do(req); err == nil {
		t.Fatal("网络策略失效")
	}
}

func TestBuiltinPreferenceCompatibility(t *testing.T) {
	f := setup(t)
	token, _ := f.account("alice")
	check(t, f.request("PATCH", "/api/v1/preferences", token, object{"experimental_vibehub_theme_enabled": true}), 200)
	st := data(t, f.request("GET", "/api/v1/plugins/markvault.vibehub", token, nil), 200)
	if st["enabled"] != true {
		t.Fatal("旧偏好未同步到插件")
	}
	check(t, f.request("PUT", "/api/v1/plugins/markvault.vibehub", token, object{"enabled": false, "config": object{}, "grants": []string{}}), 200)
	prefs := data(t, f.request("GET", "/api/v1/preferences", token, nil), 200)["preferences"].(map[string]any)
	if prefs["experimental_vibehub_theme_enabled"] != false {
		t.Fatal("插件停用未同步旧入口")
	}
	check(t, f.request("PUT", "/api/v1/plugins/markvault.uiux-pro", token, object{"enabled": true, "config": object{}, "grants": []string{}}), 200)
	prefs = data(t, f.request("GET", "/api/v1/preferences", token, nil), 200)["preferences"].(map[string]any)
	if prefs["experimental_uiux_pro_theme_enabled"] != true || prefs["experimental_vibehub_theme_enabled"] != false {
		t.Fatal("主题未互斥")
	}
	// ASCII 主题与其他界面主题同属一个互斥组，插件入口与旧偏好入口都要保持只启用一个。
	ascii := data(t, f.request("GET", "/api/v1/plugins/markvault.ascii", token, nil), 200)
	manifest := ascii["manifest"].(map[string]any)
	if ascii["enabled"] != false || ascii["preferenceBound"] != true || manifest["category"] != "appearance" || manifest["icon"] != "terminal" {
		t.Fatal("ASCII 主题应默认关闭并声明分类与图标", ascii)
	}
	check(t, f.request("PUT", "/api/v1/plugins/markvault.ascii", token, object{"enabled": true, "config": object{"background": "rain", "density": 120}, "grants": []string{}}), 200)
	prefs = data(t, f.request("GET", "/api/v1/preferences", token, nil), 200)["preferences"].(map[string]any)
	if prefs["experimental_ascii_theme_enabled"] != true || prefs["experimental_uiux_pro_theme_enabled"] != false || prefs["experimental_vibehub_theme_enabled"] != false {
		t.Fatal("启用 ASCII 主题未停用其他主题", prefs)
	}
	if classic := data(t, f.request("GET", "/api/v1/plugins/markvault.classic", token, nil), 200); classic["enabled"] != true {
		t.Fatal("启用其他主题不应停用兜底的经典主题")
	}
	for _, config := range []object{{"background": "matrix"}, {"density": 500}, {"boot": "yes"}, {"unknown": true}} {
		check(t, f.request("PUT", "/api/v1/plugins/markvault.ascii", token, object{"enabled": true, "config": config, "grants": []string{}}), 400)
	}
	check(t, f.request("PATCH", "/api/v1/preferences", token, object{"experimental_vibehub_theme_enabled": true}), 200)
	prefs = data(t, f.request("GET", "/api/v1/preferences", token, nil), 200)["preferences"].(map[string]any)
	if prefs["experimental_vibehub_theme_enabled"] != true || prefs["experimental_ascii_theme_enabled"] != false {
		t.Fatal("旧偏好入口未保持主题互斥", prefs)
	}
	check(t, f.request("PATCH", "/api/v1/preferences", token, object{"experimental_vibehub_theme_enabled": true, "experimental_ascii_theme_enabled": true}), 400)
	check(t, f.request("PUT", "/api/v1/plugins/markvault.classic", token, object{"enabled": true, "config": object{}, "grants": []string{}}), 200)
	prefs = data(t, f.request("GET", "/api/v1/preferences", token, nil), 200)["preferences"].(map[string]any)
	if prefs["experimental_vibehub_theme_enabled"] != false || prefs["experimental_ascii_theme_enabled"] != false || prefs["experimental_uiux_pro_theme_enabled"] != false {
		t.Fatal("启用经典主题应停用其他界面主题", prefs)
	}
	saved := data(t, f.request("GET", "/api/v1/plugins/markvault.ascii", token, nil), 200)
	if config := saved["config"].(map[string]any); config["background"] != "rain" || config["density"] != float64(120) {
		t.Fatal("停用主题不应丢失其配置", saved)
	}
}
