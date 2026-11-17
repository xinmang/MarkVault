package server

import "testing"

func TestOceanPreferencesPersistAcrossSessions(t *testing.T) {
	f := setup(t)
	owner, _ := f.account("ocean_owner")
	other, _ := f.account("ocean_other")
	preferences := func(token string) object {
		return data(t, f.request("GET", "/api/v1/preferences", token, nil), 200)["preferences"].(map[string]any)
	}
	defaults := preferences(owner)
	if defaults["ocean_background_scope"] != "browser" || defaults["ocean_background"] != "off" {
		t.Fatalf("升级默认值应保留浏览器选择：%v", defaults)
	}
	check(t, f.request("PATCH", "/api/v1/preferences", owner, object{"ocean_background_scope": "account", "ocean_background": "mixed", "motion_enabled": false}), 200)
	// 独立登录会话模拟另一浏览器，不依赖先前的本地缓存。
	login := data(t, f.request("POST", "/api/v1/auth/login", "", object{"username": "ocean_owner", "password": "password-123"}), 200)
	saved := preferences(str(login["access_token"]))
	if saved["ocean_background_scope"] != "account" || saved["ocean_background"] != "mixed" || saved["motion_enabled"] != false {
		t.Fatalf("新会话未读取到已保存的海洋设置：%v", saved)
	}
	if preferences(other)["ocean_background_scope"] != "browser" {
		t.Fatal("账号海洋设置影响了其他用户")
	}
	check(t, f.request("PATCH", "/api/v1/preferences", owner, object{"ocean_background_scope": "browser"}), 200)
	if preferences(owner)["ocean_background"] != "mixed" {
		t.Fatal("切回浏览器模式不应清除账号保存的样式")
	}
	check(t, f.request("PATCH", "/api/v1/preferences", owner, object{"ocean_background_scope": "account", "ocean_background": "off"}), 200)
	if preferences(owner)["ocean_background"] != "off" {
		t.Fatal("账号模式不能保存关闭选项")
	}
}

func TestOceanPreferencesValidationAndPrivacy(t *testing.T) {
	f := setup(t)
	token, _ := f.account("ocean_validation")
	for _, body := range []object{
		{"ocean_background_scope": "permanent"},
		{"ocean_background_scope": true},
		{"ocean_background": "invalid"},
		{"ocean_background": nil},
	} {
		check(t, f.request("PATCH", "/api/v1/preferences", token, body), 400)
	}
	for _, mode := range []string{"off", "sharks", "dolphins", "mixed"} {
		check(t, f.request("PATCH", "/api/v1/preferences", token, object{"ocean_background": mode}), 200)
	}
	key := str(data(t, f.request("POST", "/api/v1/settings/api-keys", token, object{"name": "偏好读取", "permissions": []string{"user.preferences.read"}}), 201)["key"])
	check(t, f.request("PATCH", "/api/v1/preferences", key, object{"ocean_background": "sharks"}), 403)
	check(t, f.request("PUT", "/api/v1/settings/share", token, object{"enabled": true, "slug": "ocean-validation"}), 200)
	public := data(t, f.request("GET", "/api/public/ocean-validation", "", nil), 200)["preferences"].(map[string]any)
	for _, field := range []string{"ocean_background_scope", "ocean_background"} {
		if _, exists := public[field]; exists {
			t.Fatalf("账号海洋偏好不应泄漏到公开分享：%s", field)
		}
	}
}
