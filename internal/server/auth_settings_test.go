package server

import (
	"markvault/internal/config"
	"testing"
)

func TestRegistrationSettingsLifecycle(t *testing.T) {
	f := setup(t)
	options := func() object { return data(t, f.request("GET", "/api/v1/auth/options", "", nil), 200) }
	if options()["registration_enabled"] != true {
		t.Fatal("新实例应允许首个用户注册")
	}
	check(t, f.request("POST", "/api/v1/auth/register", "", object{"username": "owner", "password": "password-123"}), 201)
	if options()["registration_enabled"] != false {
		t.Fatal("首个用户注册后未关闭入口")
	}
	check(t, f.request("POST", "/api/v1/auth/register", "", object{"username": "denied", "password": "password-123"}), 403)
	owner := data(t, f.request("POST", "/api/v1/auth/login", "", object{"username": "owner", "password": "password-123"}), 200)
	token := str(owner["access_token"])
	check(t, f.request("PUT", "/api/v1/settings/auth", token, object{"registration_enabled": true}), 200)
	if options()["registration_enabled"] != true {
		t.Fatal("管理员开启注册未同步公开入口")
	}
	member := data(t, f.request("POST", "/api/v1/auth/register", "", object{"username": "member", "password": "password-123"}), 201)["user"].(map[string]any)
	if member["role"] != "user" || options()["registration_enabled"] != true {
		t.Fatal("后续注册不应授予管理权限或再次自动关闭注册")
	}
	login := data(t, f.request("POST", "/api/v1/auth/login", "", object{"username": "member", "password": "password-123"}), 200)
	check(t, f.request("PUT", "/api/v1/settings/auth", str(login["access_token"]), object{"registration_enabled": false}), 403)
	check(t, f.request("PUT", "/api/v1/settings/auth", "", object{"registration_enabled": false}), 401)
	check(t, f.request("PUT", "/api/v1/settings/auth", token, object{"registration_enabled": "false"}), 400)
	check(t, f.request("PUT", "/api/v1/settings/auth", token, object{}), 400)
	check(t, f.request("PUT", "/api/v1/settings/auth", token, object{"registration_enabled": false}), 200)
	check(t, f.request("POST", "/api/v1/auth/register", "", object{"username": "later", "password": "password-123"}), 403)
	check(t, f.request("PUT", "/api/v1/settings/site", token, object{"reset_defaults": true}), 200)
	if options()["registration_enabled"] != false {
		t.Fatal("恢复品牌默认值不能重新开放注册")
	}
}

func TestRegistrationDeploymentLock(t *testing.T) {
	f := setupConfig(t, func(c *config.Config) { c.AllowRegistration = false })
	if data(t, f.request("GET", "/api/v1/auth/options", "", nil), 200)["registration_enabled"] != false {
		t.Fatal("部署锁未生效")
	}
	check(t, f.request("POST", "/api/v1/auth/register", "", object{"username": "owner", "password": "password-123"}), 403)
}
