package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"

	"markvault/internal/auth"
	"markvault/internal/plugin"
)

func (s *Server) pluginCredentials(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	st, err := s.plugins.Get(r.Context(), userID(r), pluginID(r))
	if err != nil {
		return err
	}
	if st.Origin == "builtin" {
		return problem(400, "内置凭据请使用原设置入口")
	}
	if r.Method == "GET" {
		rows, err := all(r, s.db, "SELECT name,target FROM plugin_credentials WHERE user_id=? AND plugin_id=?", userID(r), st.Manifest.ID)
		if err != nil {
			return err
		}
		return success(w, object{"credentials": rows})
	}
	var input struct {
		Name   string `json:"name"`
		Target string `json:"target"`
		Secret string `json:"secret"`
	}
	if err := decode(w, r, &input); err != nil {
		return err
	}
	if input.Name == "" || len(input.Name) > 100 {
		return problem(400, "凭据名称无效")
	}
	if input.Secret == "" {
		_, err = s.db.ExecContext(r.Context(), "DELETE FROM plugin_credentials WHERE user_id=? AND plugin_id=? AND name=?", userID(r), st.Manifest.ID, input.Name)
	} else {
		target, parseErr := url.Parse(input.Target)
		if parseErr != nil || pluginTarget(target) != nil || target.Path != "" || target.RawQuery != "" || strings.ContainsAny(input.Secret, "\r\n") || len(input.Secret) > 8192 {
			return problem(400, "凭据目标或内容无效")
		}
		cipher, e := auth.Encrypt(input.Secret, s.config.EncryptionKey)
		if e != nil {
			return e
		}
		_, err = s.db.ExecContext(r.Context(), `INSERT INTO plugin_credentials(user_id,plugin_id,name,target,ciphertext) VALUES(?,?,?,?,?) ON CONFLICT(user_id,plugin_id,name) DO UPDATE SET target=excluded.target,ciphertext=excluded.ciphertext`, userID(r), st.Manifest.ID, input.Name, input.Target, cipher)
	}
	if err != nil {
		return err
	}
	if err = s.plugins.Save(r.Context(), userID(r), st.Manifest.ID, st.Enabled, st.Config, st.Grants); err != nil {
		return err
	}
	s.stopPlugins(userID(r), st.Manifest.ID)
	return success(w, object{"saved": true})
}
func (s *Server) selectedModel(r *http.Request, settings aiSettings, system string, messages []conversationMessage, definitions []agentTool) (string, []modelCall, error) {
	st, err := s.plugins.Get(r.Context(), userID(r), "markvault.models")
	if err != nil {
		return "", nil, err
	}
	if st.Status != "running" {
		return "", nil, problem(409, "模型插件已停用")
	}
	providerID := str(st.Config["providerId"])
	if providerID == "" {
		return s.callModel(r.Context(), settings, system, messages, definitions)
	}
	value, err := s.invokeProvider(r, providerID, "chat", object{"model": settings.Model, "system": system, "messages": messages, "tools": definitions})
	if err != nil {
		return "", nil, err
	}
	result, ok := value.(map[string]any)
	if !ok {
		return "", nil, problem(502, "模型插件返回值无效")
	}
	text := str(result["content"])
	calls := []modelCall{}
	if rawCalls, ok := result["calls"].([]any); ok {
		if len(rawCalls) > 20 {
			return "", nil, problem(502, "模型插件工具调用过多")
		}
		for _, raw := range rawCalls {
			call, ok := raw.(map[string]any)
			if !ok {
				return "", nil, problem(502, "模型插件工具调用无效")
			}
			args, ok := call["arguments"].(map[string]any)
			if !ok {
				return "", nil, problem(502, "模型插件参数无效")
			}
			calls = append(calls, modelCall{ID: auth.ID(), Name: str(call["name"]), Arguments: args})
		}
	}
	return text, calls, nil
}
func (s *Server) invokeProvider(r *http.Request, identifier, operation string, args object) (any, error) {
	parts := strings.SplitN(identifier, "/", 2)
	if len(parts) != 2 {
		return nil, problem(400, "供应商格式必须为插件 ID/贡献 ID")
	}
	st, err := s.plugins.Get(r.Context(), userID(r), parts[0])
	if err != nil {
		return nil, err
	}
	if st.Status != "running" {
		return nil, problem(409, "模型供应商插件不可用")
	}
	found := false
	for _, c := range st.Manifest.Contributes {
		if c.Kind == "provider" && c.ID == parts[1] {
			found = true
		}
	}
	if !found {
		return nil, problem(400, "模型供应商未注册")
	}
	args["operation"] = operation
	broker := s.pluginBroker(r, st, false)
	return s.callPlugin(r, st, parts[1], args, func(ctx context.Context, method string, args map[string]any) (any, error) {
		if method == "models.call" {
			return nil, problem(400, "模型适配器不能递归调用模型")
		}
		return broker(ctx, method, args)
	}, 100*time.Second)
}
func (s *Server) pluginModels(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	provider := r.URL.Query().Get("provider")
	if provider != "" {
		if _, ok := s.bundle.Providers[provider]; ok {
			if err := s.requirePlugin(r, "markvault.models"); err != nil {
				return err
			}
			settings, err := s.loadAI(r)
			if err != nil {
				return err
			}
			if settings.Provider != provider {
				return problem(400, "请先配置此供应商")
			}
			value, err := s.bundle.Model.Models(r.Context(), s.modelHost(), settings)
			if err != nil {
				return err
			}
			return success(w, object{"models": value})
		}
		value, err := s.invokeProvider(r, provider, "models", object{})
		if err != nil {
			return err
		}
		return success(w, object{"models": value})
	}
	list, err := s.plugins.List(r.Context(), userID(r))
	if err != nil {
		return err
	}
	providers := []object{}
	for name, defaults := range s.bundle.Providers {
		providers = append(providers, object{"id": name, "model": defaults[1], "builtin": true})
	}
	for _, st := range list {
		if st.Status != "running" {
			continue
		}
		for _, c := range st.Manifest.Contributes {
			if c.Kind == "provider" && st.Origin != "builtin" {
				providers = append(providers, object{"id": st.Manifest.ID + "/" + c.ID, "title": c.Title, "builtin": false})
			}
		}
	}
	return success(w, object{"providers": providers})
}
func (s *Server) pluginExpose(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	var input struct {
		Tools  []string `json:"tools"`
		KeyIDs []string `json:"keyIds"`
	}
	if err := decode(w, r, &input); err != nil {
		return err
	}
	st, err := s.plugins.Get(r.Context(), userID(r), pluginID(r))
	if err != nil {
		return err
	}
	if st.Status != "running" {
		return problem(409, "插件不可用")
	}
	definitions, err := s.availableTools(r)
	if err != nil {
		return err
	}
	allowed := map[string]bool{}
	for _, d := range definitions {
		if d.PluginID == st.Manifest.ID {
			allowed[d.Name] = true
		}
	}
	for _, name := range input.Tools {
		if !allowed[name] {
			return problem(400, "只能开放当前插件的已启用工具")
		}
	}
	if len(input.KeyIDs) > 30 {
		return problem(400, "API Key 数量过多")
	}
	// 用户选择和每个 API Key 的精确工具权限都必须满足，旧通配权限不生效。
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	encoded, _ := json.Marshal(input.Tools)
	if _, err = tx.ExecContext(r.Context(), `INSERT INTO plugin_users(user_id,plugin_id,enabled,config,grants,exposed_tools) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,plugin_id) DO UPDATE SET exposed_tools=excluded.exposed_tools,generation=plugin_users.generation+1`, userID(r), st.Manifest.ID, st.Enabled, mustJSON(st.Config), mustJSON(st.Grants), string(encoded)); err != nil {
		return err
	}
	for _, keyID := range input.KeyIDs {
		var raw string
		if err = tx.QueryRowContext(r.Context(), "SELECT permissions FROM api_keys WHERE user_id=? AND id=? AND status='active'", userID(r), keyID).Scan(&raw); err != nil {
			return problem(400, "API Key 不存在")
		}
		var permissions []string
		if json.Unmarshal([]byte(raw), &permissions) != nil {
			return problem(400, "API Key 权限无效")
		}
		filtered := []string{}
		for _, p := range permissions {
			if !allowed[strings.TrimPrefix(p, "plugins.tool.")] {
				filtered = append(filtered, p)
			}
		}
		for _, name := range input.Tools {
			permission := "plugins.tool." + name
			if !plugin.Has(filtered, permission) {
				filtered = append(filtered, permission)
			}
		}
		if _, err = tx.ExecContext(r.Context(), "UPDATE api_keys SET permissions=? WHERE user_id=? AND id=?", mustJSON(filtered), userID(r), keyID); err != nil {
			return err
		}
	}
	if _, err = tx.ExecContext(r.Context(), "DELETE FROM plugin_tool_confirmations WHERE user_id=? AND plugin_id=?", userID(r), st.Manifest.ID); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	s.stopPlugins(userID(r), st.Manifest.ID)
	return success(w, object{"saved": true})
}
func mustJSON(value any) string { raw, _ := json.Marshal(value); return string(raw) }
func (s *Server) externalToolAllowed(r *http.Request, definition agentTool) bool {
	if who(r).APIKeyID == "" {
		return true
	}
	if definition.PluginID == "" {
		return permit(r, definition.Permission) == nil
	}
	exact := "plugins.tool." + definition.Name
	if !plugin.Has(who(r).Permissions, exact) {
		return false
	}
	var raw string
	if s.db.QueryRowContext(r.Context(), "SELECT exposed_tools FROM plugin_users WHERE user_id=? AND plugin_id=?", userID(r), definition.PluginID).Scan(&raw) != nil {
		return false
	}
	var names []string
	return json.Unmarshal([]byte(raw), &names) == nil && plugin.Has(names, definition.Name)
}
