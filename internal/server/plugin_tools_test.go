package server

import (
	"context"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"markvault/internal/config"
	"markvault/internal/plugin"
	"markvault/plugins"
)

func TestPluginToolConfirmationExposureAndRevocation(t *testing.T) {
	runtimePath := os.Getenv("MARKVAULT_DENO_PATH")
	if runtimePath == "" {
		runtimePath, _ = filepath.Abs("../../.data/tools/deno/deno.exe")
	}
	runtime := plugin.NewRuntime(runtimePath)
	if !runtime.Available() {
		t.Skip("Deno 隔离运行时不可用")
	}
	f := setupConfig(t, func(cfg *config.Config) { cfg.DenoPath = runtimePath })
	token, login := f.account("alice")
	uid := str(login["user"].(map[string]any)["id"])
	if _, err := f.db.Exec("UPDATE users SET role='admin' WHERE id=?", uid); err != nil {
		t.Fatal(err)
	}
	p := plugins.Samples()["examples.echo"]
	check(t, f.installPlugin(token, p.Archive), 200)
	check(t, f.request("PUT", "/api/v1/plugins/examples.echo", token, object{"enabled": true, "config": object{}, "grants": p.Manifest.Permissions}), 200)
	name := pluginToolName("examples.echo", "echo")
	pending := data(t, f.request("POST", "/api/v1/plugins/tools/call", token, object{"name": name, "arguments": object{"text": "hello"}}), 200)
	result := data(t, f.request("POST", "/api/v1/plugins/tools/call", token, object{"confirmation_token": pending["confirmation_token"]}), 200)
	if result["result"].(map[string]any)["text"] != "hello" {
		t.Fatal("脚本工具结果错误")
	}
	check(t, f.request("POST", "/api/v1/plugins/tools/call", token, object{"confirmation_token": pending["confirmation_token"]}), 409)
	pending = data(t, f.request("POST", "/api/v1/plugins/tools/call", token, object{"name": name, "arguments": object{"text": "old"}}), 200)
	check(t, f.request("PUT", "/api/v1/plugins/examples.echo", token, object{"enabled": true, "config": object{"changed": true}, "grants": p.Manifest.Permissions}), 200)
	check(t, f.request("POST", "/api/v1/plugins/tools/call", token, object{"confirmation_token": pending["confirmation_token"]}), 409)
	key := data(t, f.request("POST", "/api/v1/settings/api-keys", token, object{"name": "plugin-client", "permissions": []string{"bookmarks.*", "tags.*"}}), 201)
	apiKey := str(key["key"])
	listed := check(t, f.request("POST", "/api/mcp", apiKey, object{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}), 200)
	for _, raw := range listed["result"].(map[string]any)["tools"].([]any) {
		if raw.(map[string]any)["name"] == name {
			t.Fatal("未授权工具泄漏给旧 Key")
		}
	}
	check(t, f.request("PUT", "/api/v1/plugins/examples.echo/exposure", token, object{"tools": []string{name}, "keyIds": []string{str(key["id"])}}), 200)
	called := check(t, f.request("POST", "/api/mcp", apiKey, object{"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": object{"name": name, "arguments": object{"text": "external", "confirm": true}}}), 200)
	if called["result"].(map[string]any)["isError"] == true {
		t.Fatal("精确工具授权调用失败", called)
	}
	check(t, f.request("PUT", "/api/v1/plugins/examples.echo/exposure", token, object{"tools": []string{}, "keyIds": []string{str(key["id"])}}), 200)
	called = check(t, f.request("POST", "/api/mcp", apiKey, object{"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": object{"name": name, "arguments": object{"text": "external", "confirm": true}}}), 200)
	if called["result"].(map[string]any)["isError"] != true {
		t.Fatal("撤销授权后仍能调用")
	}
	// 用已认证主体检查精确授权，业务通配不会获得新工具。
	server := &Server{bundle: plugins.Bundle(), db: f.db, config: config.Config{}, plugins: &plugin.Store{DB: f.db, Builtins: plugins.Builtins(), RuntimeAvailable: true, Policy: plugins.Policy()}}
	request := httptest.NewRequest("POST", "/api/mcp", nil)
	request = request.WithContext(context.WithValue(request.Context(), authContextKey{}, &principal{UserID: uid, APIKeyID: "test", Permissions: []string{"bookmarks.*"}}))
	definition := agentTool{Name: name, PluginID: "examples.echo"}
	if server.externalToolAllowed(request, definition) {
		t.Fatal("旧 Key 自动获得插件工具")
	}
	if _, err := f.db.Exec("UPDATE plugin_users SET exposed_tools=? WHERE user_id=? AND plugin_id='examples.echo'", mustJSON([]string{name}), uid); err != nil {
		t.Fatal(err)
	}
	who(request).Permissions = append(who(request).Permissions, "plugins.tool."+name)
	if !server.externalToolAllowed(request, definition) {
		t.Fatal("精确授权未生效")
	}
	if _, err := f.db.Exec("UPDATE plugin_users SET exposed_tools='[]' WHERE user_id=? AND plugin_id='examples.echo'", uid); err != nil {
		t.Fatal(err)
	}
	if server.externalToolAllowed(request, definition) {
		t.Fatal("撤权未生效")
	}
}
