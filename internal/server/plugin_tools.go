package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"markvault/internal/auth"
)

func pluginToolName(pluginID, localID string) string {
	sum := sha256.Sum256([]byte(pluginID + ":" + localID))
	return "plugin_" + hex.EncodeToString(sum[:16])
}

type expectedPluginRevision struct{}

func findDefinition(definitions []agentTool, name string) (agentTool, bool) {
	for _, definition := range definitions {
		if definition.Name == name {
			return definition, true
		}
	}
	return agentTool{}, false
}
func (s *Server) availableTools(r *http.Request) ([]agentTool, error) {
	list, err := s.plugins.List(r.Context(), userID(r))
	if err != nil {
		return nil, err
	}
	definitions := []agentTool{}
	for _, st := range list {
		if st.Status != "running" {
			continue
		}
		if st.Manifest.ID == "markvault.tools" {
			definitions = append(definitions, s.bundle.Tools()...)
			continue
		}
		if st.Origin == "builtin" {
			continue
		}
		for _, c := range st.Manifest.Contributes {
			if c.Kind != "tool" {
				continue
			}
			schema := object{"type": "object", "properties": object{}, "additionalProperties": false}
			if c.InputSchema != nil {
				encoded, _ := json.Marshal(c.InputSchema)
				_ = json.Unmarshal(encoded, &schema)
			}
			properties, _ := schema["properties"].(map[string]any)
			if properties == nil {
				properties = object{}
				schema["properties"] = properties
			}
			properties["confirm"] = object{"type": "boolean"}
			definitions = append(definitions, agentTool{Name: pluginToolName(st.Manifest.ID, c.ID), Title: c.Title, Description: st.Manifest.Name + ": " + c.Title, Schema: schema, Write: true, PluginID: st.Manifest.ID, Revision: st.Revision})
		}
	}
	if s.requirePlugin(r, "markvault.mcp-client") == nil {
		external, e := s.externalTools(r)
		if e != nil {
			return nil, e
		}
		definitions = append(definitions, external...)
	}
	return definitions, nil
}
func (s *Server) executePluginTool(r *http.Request, name string, args object, confirmed bool) (object, error) {
	// 第三方工具需要用户开放和 API Key 精确工具授权，业务通配权限不继承。

	definitions, err := s.availableTools(r)
	if err != nil {
		return nil, err
	}
	definition, ok := findDefinition(definitions, name)
	if !ok || definition.PluginID == "" {
		return nil, problem(404, "工具不可用")
	}
	if definition.Write && !confirmed {
		return nil, problem(409, "第三方工具必须经过确认")
	}
	if expected, ok := r.Context().Value(expectedPluginRevision{}).(string); ok && expected != definition.Revision {
		return nil, problem(409, "插件版本已变化，请重新确认")
	}
	if !s.externalToolAllowed(r, definition) {
		return nil, problem(403, "API Key 未获此插件工具授权")
	}
	if err = validateSchema(args, definition.Schema, "arguments"); err != nil {
		return nil, err
	}
	if definition.PluginID == "markvault.mcp-client" {
		return s.executeExternalTool(r, name, args, definition.Revision)
	}
	st, err := s.plugins.Get(r.Context(), userID(r), definition.PluginID)
	if err != nil {
		return nil, err
	}
	if st.Revision != definition.Revision || st.Status != "running" {
		return nil, problem(409, "插件状态已变化，请重新确认")
	}
	local := ""
	for _, c := range st.Manifest.Contributes {
		if c.Kind == "tool" && pluginToolName(st.Manifest.ID, c.ID) == name {
			local = c.ID
		}
	}
	values := object{}
	for k, v := range args {
		if k != "confirm" {
			values[k] = v
		}
	}
	result, err := s.callPlugin(r, st, local, values, s.pluginBroker(r, st, true), 30*time.Second)
	if err != nil {
		_, _ = s.db.ExecContext(context.WithoutCancel(r.Context()), "UPDATE plugin_users SET last_error=? WHERE user_id=? AND plugin_id=?", "插件工具执行失败或超时 / Tool failed or timed out", userID(r), st.Manifest.ID)
		return nil, problem(502, "插件工具执行失败或超时")
	}
	_, _ = s.db.ExecContext(r.Context(), "UPDATE plugin_users SET last_error='' WHERE user_id=? AND plugin_id=?", userID(r), st.Manifest.ID)
	return object{"result": result}, nil
}
func (s *Server) pluginAgentChat(w http.ResponseWriter, r *http.Request, agentID string, input any) error {
	parts := strings.SplitN(agentID, "/", 2)
	if len(parts) != 2 {
		return problem(400, "agentId 必须为插件 ID/贡献 ID")
	}
	st, err := s.plugins.Get(r.Context(), userID(r), parts[0])
	if err != nil {
		return err
	}
	if st.Status != "running" {
		return problem(409, "Agent 插件不可用")
	}
	found := false
	for _, c := range st.Manifest.Contributes {
		if c.Kind == "agent" && c.ID == parts[1] {
			found = true
		}
	}
	if !found {
		return problem(400, "Agent 未注册")
	}
	raw, _ := json.Marshal(input)
	args := object{}
	_ = json.Unmarshal(raw, &args)
	value, err := s.callPlugin(r, st, parts[1], args, s.pluginBroker(r, st, false), 100*time.Second)
	if err != nil {
		return problem(502, "Agent 插件执行失败")
	}
	if result, ok := value.(map[string]any); ok {
		pending := []object{}
		definitions, e := s.availableTools(r)
		if e != nil {
			return e
		}
		if calls, ok := result["calls"].([]any); ok {
			if len(calls) > 20 {
				return problem(400, "Agent 插件建议操作过多")
			}
			for _, raw := range calls {
				call, ok := raw.(map[string]any)
				if !ok {
					return problem(400, "Agent 插件工具格式无效")
				}
				definition, ok := findDefinition(definitions, str(call["name"]))
				if !ok {
					return problem(400, "Agent 插件请求了未知工具")
				}
				arguments, ok := call["arguments"].(map[string]any)
				if !ok {
					return problem(400, "Agent 插件参数格式无效")
				}
				if definition.Write {
					arguments["confirm"] = true
				}
				if e = validateSchema(arguments, definition.Schema, "arguments"); e != nil {
					return e
				}
				delete(arguments, "confirm")
				action := s.bundle.Agent.Pending(modelCall{ID: auth.ID(), Name: definition.Name, Arguments: arguments}, definition)
				token := auth.ID()
				expires := time.Now().Add(10 * time.Minute).UTC().Format(time.RFC3339Nano)
				_, e = s.db.ExecContext(r.Context(), `INSERT INTO agent_pending_actions(id,user_id,tool_call_id,tool_name,arguments_json,title,summary,destructive,expires_at,created_at,plugin_revision) VALUES(?,?,?,?,?,?,?,?,?,?,?)`, token, userID(r), action["id"], definition.Name, mustJSON(arguments), action["title"], action["summary"], action["destructive"], expires, now(), definition.Revision)
				if e != nil {
					return e
				}
				action["confirmation_token"] = token
				action["expires_at"] = expires
				pending = append(pending, action)
			}
		}
		return success(w, object{"message": object{"role": "assistant", "content": str(result["content"])}, "pending_actions": pending, "model": agentID})
	}
	return success(w, object{"message": object{"role": "assistant", "content": fmt.Sprint(value)}, "pending_actions": []object{}, "model": agentID})
}
func (s *Server) pluginToolCall(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	var input struct {
		Name      string `json:"name"`
		Arguments object `json:"arguments"`
		Token     string `json:"confirmation_token"`
	}
	if err := decode(w, r, &input); err != nil {
		return err
	}
	if input.Token != "" {
		var name, raw, revision string
		err := s.db.QueryRowContext(r.Context(), `UPDATE plugin_tool_confirmations SET used=1 WHERE id=? AND user_id=? AND used=0 AND expires_at>? RETURNING tool,arguments,revision`, input.Token, userID(r), time.Now().Unix()).Scan(&name, &raw, &revision)
		if err != nil {
			return problem(409, "确认凭证已失效")
		}
		definitions, err := s.availableTools(r)
		if err != nil {
			return err
		}
		definition, ok := findDefinition(definitions, name)
		if !ok || definition.Revision != revision {
			return problem(409, "插件配置已变更")
		}
		args := object{}
		if json.Unmarshal([]byte(raw), &args) != nil {
			return problem(400, "参数无效")
		}
		args["confirm"] = true
		request := r.WithContext(context.WithValue(r.Context(), expectedPluginRevision{}, revision))
		result, err := s.executeTool(request, name, args, true)
		if err != nil {
			return err
		}
		return success(w, result)
	}
	definitions, err := s.availableTools(r)
	if err != nil {
		return err
	}
	definition, ok := findDefinition(definitions, input.Name)
	if !ok || definition.PluginID == "" {
		return problem(400, "未知插件工具")
	}
	if input.Arguments == nil {
		input.Arguments = object{}
	}
	delete(input.Arguments, "confirm")
	if err = validateSchema(input.Arguments, definition.Schema, "arguments"); err != nil {
		return err
	}
	token := auth.ID()
	raw, _ := json.Marshal(input.Arguments)
	_, err = s.db.ExecContext(r.Context(), "INSERT INTO plugin_tool_confirmations(id,user_id,plugin_id,tool,arguments,revision,expires_at) VALUES(?,?,?,?,?,?,?)", token, userID(r), definition.PluginID, input.Name, string(raw), definition.Revision, time.Now().Add(10*time.Minute).Unix())
	if err != nil {
		return err
	}
	return success(w, object{"confirmation_token": token, "title": definition.Title, "arguments": input.Arguments})
}
func (s *Server) pluginTools(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	definitions, err := s.availableTools(r)
	if err != nil {
		return err
	}
	return success(w, object{"tools": definitions})
}
