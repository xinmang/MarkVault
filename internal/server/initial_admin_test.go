package server

import (
	"sync"
	"testing"
)

func TestInitialAdminRegistrationAndPermissions(t *testing.T) {
	f := setup(t)
	first := data(t, f.request("POST", "/api/v1/auth/register", "", object{"username": "owner", "password": "password-123"}), 201)["user"].(map[string]any)
	if first["role"] != "admin" {
		t.Fatal("首个注册账号未成为管理员")
	}
	login := data(t, f.request("POST", "/api/v1/auth/login", "", object{"username": "owner", "password": "password-123"}), 200)
	owner := str(login["access_token"])
	check(t, f.request("PUT", "/api/v1/settings/auth", owner, object{"registration_enabled": true}), 200)
	if login["user"].(map[string]any)["role"] != "admin" {
		t.Fatal("登录未返回管理员角色")
	}
	member, memberLogin := f.account("member")
	if memberLogin["user"].(map[string]any)["role"] != "user" {
		t.Fatal("后续注册账号不应成为管理员")
	}
	for _, test := range []struct {
		token string
		admin bool
	}{{owner, true}, {member, false}} {
		site := data(t, f.request("GET", "/api/v1/settings/site", test.token, nil), 200)
		plugins := data(t, f.request("GET", "/api/v1/plugins", test.token, nil), 200)
		if site["can_edit"] != test.admin || plugins["admin"] != test.admin {
			t.Fatal("站点和插件管理权限与账号角色不一致")
		}
	}
	check(t, f.request("PUT", "/api/v1/settings/site", owner, object{"site_name": "管理员站点"}), 200)
	check(t, f.request("PUT", "/api/v1/settings/site", member, object{"site_name": "越权修改"}), 403)
	check(t, f.request("PATCH", "/api/v1/preferences", member, object{"role": "admin"}), 400)
	forged := data(t, f.request("POST", "/api/v1/auth/register", "", object{"username": "forged", "password": "password-123", "role": "admin"}), 201)["user"].(map[string]any)
	if forged["role"] != "user" {
		t.Fatal("客户端伪造角色获得了管理员权限")
	}
	site := data(t, f.request("GET", "/api/v1/site", "", nil), 200)["site"].(map[string]any)
	if site["site_name"] != "管理员站点" {
		t.Fatal("普通用户修改了站点设置")
	}
}

func TestConcurrentRegistrationCreatesOneAdmin(t *testing.T) {
	f := setup(t)
	start := make(chan struct{})
	var wg sync.WaitGroup
	codes := make(chan int, 4)
	for _, name := range []string{"member_a", "member_b", "member_c", "member_d"} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			codes <- f.request("POST", "/api/v1/auth/register", "", object{"username": name, "password": "password-123"}).Code
		}()
	}
	close(start)
	wg.Wait()
	close(codes)
	succeeded := 0
	for code := range codes {
		if code == 201 {
			succeeded++
		} else if code != 403 {
			t.Fatalf("并发注册失败：%d", code)
		}
	}
	var users, admins, initialized int
	if err := f.db.QueryRow("SELECT COUNT(*), SUM(role='admin'), (SELECT COUNT(*) FROM instance_initialization) FROM users").Scan(&users, &admins, &initialized); err != nil {
		t.Fatal(err)
	}
	if succeeded != 1 || users != 1 || admins != 1 || initialized != 1 {
		t.Fatalf("并发初始化错误：用户=%d，管理员=%d，初始化标记=%d", users, admins, initialized)
	}
}

func TestFailedInitialRegistrationRollsBackClaim(t *testing.T) {
	f := setup(t)
	if _, err := f.db.Exec("CREATE TRIGGER fail_preferences BEFORE INSERT ON user_preferences BEGIN SELECT RAISE(ABORT, '测试注册回滚'); END"); err != nil {
		t.Fatal(err)
	}
	check(t, f.request("POST", "/api/v1/auth/register", "", object{"username": "failed", "password": "password-123"}), 500)
	var count int
	if err := f.db.QueryRow("SELECT (SELECT COUNT(*) FROM users) + (SELECT COUNT(*) FROM instance_initialization)").Scan(&count); err != nil || count != 0 {
		t.Fatalf("失败注册遗留用户或初始化标记：%d %v", count, err)
	}
	if _, err := f.db.Exec("DROP TRIGGER fail_preferences"); err != nil {
		t.Fatal(err)
	}
	_, login := f.account("owner")
	if login["user"].(map[string]any)["role"] != "admin" {
		t.Fatal("失败注册消耗了首个管理员资格")
	}
}

func TestRegistrationCannotReclaimAdmin(t *testing.T) {
	for _, remove := range []bool{false, true} {
		t.Run(map[bool]string{false: "撤销管理员角色", true: "删除所有账号"}[remove], func(t *testing.T) {
			f := setup(t)
			f.account("owner")
			query := "UPDATE users SET role='user'"
			if remove {
				query = "DELETE FROM users"
			}
			if _, err := f.db.Exec(query); err != nil {
				t.Fatal(err)
			}
			token, login := f.account("later")
			if login["user"].(map[string]any)["role"] != "user" {
				t.Fatal("后续账号重新领取了管理员资格")
			}
			check(t, f.request("PUT", "/api/v1/settings/site", token, object{"site_name": "越权"}), 403)
		})
	}
}
