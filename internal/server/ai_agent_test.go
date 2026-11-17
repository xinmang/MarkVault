package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync/atomic"
	"testing"

	"markvault/internal/config"
)

func configureAI(t *testing.T, f *fixture, token, provider, endpoint string) {
	t.Helper()
	settings := data(t, f.request("PUT", "/api/v1/settings/ai", token, object{"provider": provider, "apiUrl": endpoint, "model": "test-model", "apiKey": "test-secret-key", "enabled": true}), 200)
	if strings.Contains(stringMustJSON(settings), "test-secret-key") {
		t.Fatal("响应泄漏 AI 密钥")
	}
}
func TestAISettingsAndEndpointGuards(t *testing.T) {
	f := setup(t)
	token, _ := f.account("alice")
	for _, endpoint := range []string{"http://127.0.0.1:1234/v1", "http://[::1]/v1", "http://localhost/v1", "http://169.254.169.254", "https://user:pass@example.com", "https://example.com?secret=1"} {
		check(t, f.request("PUT", "/api/v1/settings/ai", token, object{"provider": "custom", "apiUrl": endpoint, "model": "test", "apiKey": "secret", "enabled": true}), 400)
	}
	configureAI(t, f, token, "custom", "https://example.com/v1")
	var encrypted string
	if err := f.db.QueryRow("SELECT api_keys_encrypted FROM ai_settings").Scan(&encrypted); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(encrypted, "v1.") || strings.Contains(encrypted, "test-secret-key") {
		t.Fatal("AI 密钥未加密")
	}
	saved := data(t, f.request("PUT", "/api/v1/settings/ai", token, object{"provider": "custom", "apiUrl": "https://example.com/v1", "model": "test", "enabled": true}), 200)["settings"].(map[string]any)
	if saved["hasApiKey"] != true {
		t.Fatal("未保留已有密钥")
	}
	cleared := data(t, f.request("PUT", "/api/v1/settings/ai", token, object{"provider": "custom", "apiUrl": "https://example.com/v1", "model": "test", "enabled": false, "clearApiKey": true}), 200)["settings"].(map[string]any)
	if cleared["hasApiKey"] != false {
		t.Fatal("未清除密钥")
	}
	for _, ip := range []string{"127.0.0.1", "::1", "10.0.0.1", "::ffff:192.168.1.1", "100.64.0.1", "169.254.169.254", "192.0.2.1", "2001:db8::1"} {
		if publicIP(netip.MustParseAddr(ip)) {
			t.Errorf("错误允许地址 %s", ip)
		}
	}
}
func TestAIReadToolsAndConfirmation(t *testing.T) {
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" || r.Header.Get("Authorization") != "Bearer test-secret-key" {
			t.Error("AI 请求契约错误")
		}
		var request object
		if json.NewDecoder(r.Body).Decode(&request) != nil {
			t.Error("AI 请求 JSON 无效")
		}
		n := calls.Add(1)
		message := object{"role": "assistant"}
		switch n {
		case 1:
			message["tool_calls"] = []object{{"id": "read1", "type": "function", "function": object{"name": "markvault_get_account", "arguments": "{}"}}}
		case 2:
			if !strings.Contains(stringMustJSON(request["messages"]), "total_bookmarks") {
				t.Error("未传递读取工具结果")
			}
			message["content"] = "没有书签"
		default:
			message["tool_calls"] = []object{{"id": "write1", "type": "function", "function": object{"name": "markvault_create_bookmark", "arguments": `{"title":"待确认","url":"https://example.com/confirmed"}`}}}
		}
		_ = json.NewEncoder(w).Encode(object{"choices": []object{{"message": message}}})
	}))
	defer upstream.Close()
	f := setupConfig(t, func(c *config.Config) { c.AllowPrivateAI = true })
	token, _ := f.account("alice")
	other, _ := f.account("bob")
	configureAI(t, f, token, "custom", upstream.URL+"/v1")
	payload := object{"messages": []object{{"role": "user", "content": "查看书签"}}}
	reply := data(t, f.request("POST", "/api/v1/agent/chat", token, payload), 200)
	if reply["message"].(map[string]any)["content"] != "没有书签" || calls.Load() != 2 {
		t.Fatal("读取工具多轮调用失败")
	}
	reply = data(t, f.request("POST", "/api/v1/agent/chat", token, payload), 200)
	pending := reply["pending_actions"].([]any)[0].(map[string]any)
	var count int
	_ = f.db.QueryRow("SELECT COUNT(*) FROM bookmarks").Scan(&count)
	if count != 0 {
		t.Fatal("确认前执行了写操作")
	}
	confirmation := object{"confirmation_token": pending["confirmation_token"], "arguments": object{"url": "https://evil.example"}}
	check(t, f.request("POST", "/api/v1/agent/chat/confirm", other, confirmation), 409)
	confirmed := data(t, f.request("POST", "/api/v1/agent/chat/confirm", token, confirmation), 200)
	if confirmed["result"].(map[string]any)["bookmark"].(map[string]any)["url"] != "https://example.com/confirmed" {
		t.Fatal("确认操作受客户端篡改")
	}
	check(t, f.request("POST", "/api/v1/agent/chat/confirm", token, confirmation), 409)
	reply = data(t, f.request("POST", "/api/v1/agent/chat", token, payload), 200)
	pending = reply["pending_actions"].([]any)[0].(map[string]any)
	confirmation = object{"confirmation_token": pending["confirmation_token"]}
	check(t, f.request("POST", "/api/v1/agent/chat/cancel", token, confirmation), 200)
	check(t, f.request("POST", "/api/v1/agent/chat/confirm", token, confirmation), 409)
	usage := data(t, f.request("GET", "/api/v1/analytics/agent?source=chat", token, nil), 200)
	if summaryNumber(t, usage, "calls") != 7 || summaryNumber(t, usage, "tool_calls") != 2 || summaryNumber(t, usage, "failed_calls") != 2 {
		t.Fatalf("站内 Agent 统计重复计数，或将待确认/取消操作记为工具执行：%v", usage["summary"])
	}
}
func TestAIClaudeAndRedirect(t *testing.T) {
	var hits atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits.Add(1) }))
	defer target.Close()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/redirect/messages" {
			http.Redirect(w, r, target.URL, 302)
			return
		}
		if r.URL.Path != "/v1/messages" || r.Header.Get("x-api-key") != "test-secret-key" || r.Header.Get("anthropic-version") == "" {
			t.Error("Claude 请求契约错误")
		}
		_ = json.NewEncoder(w).Encode(object{"content": []object{{"type": "text", "text": "Claude 已连接"}}})
	}))
	defer upstream.Close()
	f := setupConfig(t, func(c *config.Config) { c.AllowPrivateAI = true })
	token, _ := f.account("alice")
	configureAI(t, f, token, "claude", upstream.URL+"/v1")
	check(t, f.request("POST", "/api/v1/settings/ai/test", token, object{}), 200)
	configureAI(t, f, token, "claude", upstream.URL+"/redirect")
	check(t, f.request("POST", "/api/v1/settings/ai/test", token, object{}), 502)
	if hits.Load() != 0 {
		t.Fatal("AI 请求跟随了重定向")
	}
}
func TestMCPPermissionsAndTools(t *testing.T) {
	f := setup(t)
	token, _ := f.account("alice")
	key := str(data(t, f.request("POST", "/api/v1/settings/api-keys", token, object{"name": "只读", "permissions": []string{"bookmarks.read"}}), 201)["key"])
	request := func(method string, params object) object {
		return check(t, f.request("POST", "/api/mcp", key, object{"jsonrpc": "2.0", "id": 1, "method": method, "params": params}), 200)
	}
	check(t, f.request("POST", "/api/mcp", token, object{"jsonrpc": "2.0", "id": 1, "method": "ping"}), 401)
	list := request("tools/list", object{})["result"].(map[string]any)["tools"].([]any)
	if len(list) == 0 {
		t.Fatal("没有读取工具")
	}
	for _, item := range list {
		if strings.Contains(str(item.(map[string]any)["name"]), "create") {
			t.Fatal("只读密钥暴露写工具")
		}
	}
	result := request("tools/call", object{"name": "markvault_create_bookmark", "arguments": object{"title": "越权", "url": "https://example.com", "confirm": true}})["result"].(map[string]any)
	if result["isError"] != true {
		t.Fatal("只读密钥执行写工具")
	}
	key = str(data(t, f.request("POST", "/api/v1/settings/api-keys", token, object{"name": "写入", "permissions": []string{"bookmarks.read", "bookmarks.create", "tags.read", "tags.assign", "tags.create"}}), 201)["key"])
	args := object{"title": "MCP", "url": "https://example.com/mcp", "tags": []string{"测试"}}
	result = request("tools/call", object{"name": "markvault_create_bookmark", "arguments": args})["result"].(map[string]any)
	if result["isError"] != true {
		t.Fatal("未确认的 MCP 写操作被执行")
	}
	args["confirm"] = true
	result = request("tools/call", object{"name": "markvault_create_bookmark", "arguments": args})["result"].(map[string]any)
	if result["isError"] != false {
		t.Fatalf("MCP 创建失败: %v", result)
	}
	bookmark := result["structuredContent"].(map[string]any)["bookmark"].(map[string]any)
	tag := bookmark["tags"].([]any)[0].(map[string]any)
	result = request("tools/call", object{"name": "markvault_list_bookmarks", "arguments": object{"tag_ids": []any{tag["id"]}}})["result"].(map[string]any)
	if len(result["structuredContent"].(map[string]any)["bookmarks"].([]any)) != 1 {
		t.Fatal("工具标签筛选失败")
	}
	check(t, f.request("PUT", "/api/v1/settings/ai", key, object{}), 403)
	check(t, f.request("POST", "/api/mcp", key, object{"jsonrpc": "2.0", "method": "notifications/initialized"}), 202)
}
