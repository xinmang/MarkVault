package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func (f *fixture) passkeyRequest(path, token, origin string, body any, cookie *http.Cookie) *httptest.ResponseRecorder {
	raw, err := json.Marshal(body)
	if err != nil {
		f.t.Fatal(err)
	}
	r := httptest.NewRequest("POST", path, bytes.NewReader(raw))
	r.Host = "localhost:8787"
	r.Header.Set("Content-Type", "application/json")
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	if cookie != nil {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	f.handler.ServeHTTP(w, r)
	return w
}

func enablePasskey(t *testing.T, f *fixture, token string) {
	t.Helper()
	check(t, f.request("PUT", "/api/v1/plugins/markvault.passkey", token, object{"enabled": true, "config": object{}, "grants": []string{}}), 200)
}

func TestPasskeyRegistrationGuards(t *testing.T) {
	f := setup(t)
	token, _ := f.account("owner")
	other, _ := f.account("other")
	begin := "/api/v1/auth/passkey/register/begin"
	finish := "/api/v1/auth/passkey/register/finish"
	payload := object{"name": "设备", "password": "password-123"}
	check(t, f.passkeyRequest(begin, token, "http://localhost:8787", payload, nil), 403)
	enablePasskey(t, f, token)
	for _, origin := range []string{"", "https://evil.example", "http://localhost:8787/", "null"} {
		check(t, f.passkeyRequest(begin, token, origin, payload, nil), 400)
	}
	check(t, f.passkeyRequest(begin, token, "http://localhost:8787", object{"name": "设备", "password": "wrong"}, nil), 403)
	response := f.passkeyRequest(begin, token, "http://localhost:8787", payload, nil)
	started := data(t, response, 200)
	cookies := response.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteStrictMode {
		t.Fatal("挑战缺少浏览器绑定")
	}
	options := started["options"].(map[string]any)["publicKey"].(map[string]any)
	selection := options["authenticatorSelection"].(map[string]any)
	if selection["userVerification"] != "required" || selection["residentKey"] != "required" {
		t.Fatal("密钥未强制用户验证与可发现凭据")
	}
	answer := object{"session_id": started["session_id"], "credential": object{}}
	check(t, f.passkeyRequest(finish, token, "http://localhost:8787", answer, nil), 400)
	check(t, f.passkeyRequest(finish, other, "http://localhost:8787", answer, cookies[0]), 400)
	check(t, f.passkeyRequest(finish, token, "http://localhost:8787", answer, cookies[0]), 400)
	var count int
	if err := f.db.QueryRow("SELECT COUNT(*) FROM passkey_sessions").Scan(&count); err != nil || count != 0 {
		t.Fatal("失败挑战未消费")
	}
	check(t, f.passkeyRequest(finish, token, "http://localhost:8787", answer, cookies[0]), 400)
	if err := f.db.QueryRow("SELECT COUNT(*) FROM passkey_credentials").Scan(&count); err != nil || count != 0 {
		t.Fatal("无效响应创建了凭据")
	}
}

func TestPasskeyChallengeExpiryAndSessionBinding(t *testing.T) {
	f := setup(t)
	token, _ := f.account("owner")
	enablePasskey(t, f, token)
	for _, test := range []string{"过期", "切换登录会话"} {
		t.Run(test, func(t *testing.T) {
			response := f.passkeyRequest("/api/v1/auth/passkey/register/begin", token, "http://localhost:8787", object{"name": "设备", "password": "password-123"}, nil)
			started := data(t, response, 200)
			nextToken := token
			status := 400
			if test == "过期" {
				if _, err := f.db.Exec("UPDATE passkey_sessions SET expires_at=0"); err != nil {
					t.Fatal(err)
				}
			} else {
				next := data(t, f.request("POST", "/api/v1/auth/login", "", object{"username": "owner", "password": "password-123"}), 200)
				nextToken = str(next["access_token"])
				status = 403
			}
			check(t, f.passkeyRequest("/api/v1/auth/passkey/register/finish", nextToken, "http://localhost:8787", object{"session_id": started["session_id"], "credential": object{}}, response.Result().Cookies()[0]), status)
		})
	}
}

func TestPasskeyDeleteOwnershipAndPluginDisable(t *testing.T) {
	f := setup(t)
	token, login := f.account("owner")
	other, _ := f.account("other")
	uid := str(login["user"].(map[string]any)["id"])
	enablePasskey(t, f, token)
	if _, err := f.db.Exec("INSERT INTO passkey_credentials(id,user_id,rp_id,name,credential,created_at) VALUES('credential',?,'localhost','设备','{}',datetime('now'))", uid); err != nil {
		t.Fatal(err)
	}
	available := data(t, f.request("GET", "/api/v1/auth/options", "", nil), 200)
	if available["passkey_enabled"] != true {
		t.Fatal("已绑定的通行密钥未开放登录入口")
	}
	check(t, f.request("POST", "/api/v1/auth/passkey/credentials/credential/delete", other, object{"password": "password-123"}), 404)
	check(t, f.request("POST", "/api/v1/auth/passkey/credentials/credential/delete", token, object{"password": "wrong"}), 403)
	check(t, f.request("POST", "/api/v1/plugin-admin/markvault.passkey/disable", token, nil), 200)
	check(t, f.passkeyRequest("/api/v1/auth/passkey/login/begin", "", "http://localhost:8787", object{}, nil), 403)
	if data(t, f.request("GET", "/api/v1/auth/options", "", nil), 200)["passkey_enabled"] != false {
		t.Fatal("全局停用后仍显示入口")
	}
	check(t, f.request("DELETE", "/api/v1/plugins/markvault.passkey/data", token, nil), 409)
	check(t, f.request("POST", "/api/v1/auth/passkey/credentials/credential/delete", token, object{"password": "password-123"}), 204)
	check(t, f.request("POST", "/api/v1/plugin-admin/markvault.passkey/allow", token, nil), 200)
	if data(t, f.request("GET", "/api/v1/auth/options", "", nil), 200)["passkey_enabled"] != false {
		t.Fatal("最后一把密钥删除后仍显示入口")
	}
}
