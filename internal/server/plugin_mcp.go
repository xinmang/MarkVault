package server

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"markvault/internal/auth"
	"markvault/internal/plugin"
)

type mcpConnection struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	URL          string   `json:"url"`
	Transport    string   `json:"transport"`
	Header       string   `json:"header"`
	Secret       string   `json:"secret,omitempty"`
	HasSecret    bool     `json:"hasSecret"`
	Tools        []object `json:"tools"`
	Selected     []string `json:"selected"`
	AutoApproved []string `json:"autoApproved"`
	Generation   int      `json:"generation"`
}

func (s *Server) mcpConnections(r *http.Request) ([]mcpConnection, error) {
	rows, err := s.db.QueryContext(r.Context(), "SELECT id,name,url,transport,auth_header,ciphertext,tools,selected,generation,auto_approved FROM plugin_mcp_connections WHERE user_id=? ORDER BY name,id", userID(r))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []mcpConnection{}
	for rows.Next() {
		var c mcpConnection
		var cipher, raw, selected, approved string
		if err = rows.Scan(&c.ID, &c.Name, &c.URL, &c.Transport, &c.Header, &cipher, &raw, &selected, &c.Generation, &approved); err != nil {
			return nil, err
		}
		c.HasSecret = cipher != ""
		c.Tools = []object{}
		c.Selected = []string{}
		c.AutoApproved = []string{}
		if json.Unmarshal([]byte(raw), &c.Tools) != nil || json.Unmarshal([]byte(selected), &c.Selected) != nil || json.Unmarshal([]byte(approved), &c.AutoApproved) != nil {
			return nil, problem(500, "MCP 配置无效")
		}
		list = append(list, c)
	}
	return list, rows.Err()
}
func (s *Server) mcpConnectionHandler(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	if err := s.requirePlugin(r, "markvault.mcp-client"); err != nil {
		return err
	}
	identifier := chi.URLParam(r, "connectionId")
	if r.Method != "GET" {
		defer s.stopPlugins(userID(r), "markvault.mcp-client")
	}
	if r.Method == "GET" {
		list, err := s.mcpConnections(r)
		if err != nil {
			return err
		}
		for _, c := range list {
			s.watchMCP(r, c)
		}
		return success(w, object{"connections": list})
	}
	if r.Method == "DELETE" {
		_, err := s.db.ExecContext(r.Context(), "DELETE FROM plugin_mcp_connections WHERE user_id=? AND id=?", userID(r), identifier)
		if err != nil {
			return err
		}
		return success(w, object{"deleted": true})
	}
	var input mcpConnection
	if err := decode(w, r, &input); err != nil {
		return err
	}
	u, err := url.Parse(input.URL)
	if err != nil || pluginTarget(u) != nil || u.RawQuery != "" {
		return problem(400, "MCP 地址必须为不含凭据或查询的 HTTPS URL")
	}
	if input.Transport != "http" && input.Transport != "sse" {
		return problem(400, "MCP 传输只支持 http 或 sse")
	}
	if strings.TrimSpace(input.Name) == "" || len(input.Name) > 120 || len(input.Secret) > 8192 || strings.ContainsAny(input.Secret, "\r\n") {
		return problem(400, "MCP 名称或凭据无效")
	}
	if input.Header != "" && !strings.EqualFold(input.Header, "Authorization") && !regexp.MustCompile(`(?i)^x-[a-z0-9-]{1,60}$`).MatchString(input.Header) {
		return problem(400, "认证请求头仅支持 Authorization 或 X-* API Key")
	}
	if identifier == "" {
		identifier = auth.ID()
	}
	var cipher string
	if input.Secret != "" {
		cipher, err = auth.Encrypt(input.Secret, s.config.EncryptionKey)
		if err != nil {
			return err
		}
	} else {
		var oldURL, oldHeader string
		_ = s.db.QueryRowContext(r.Context(), "SELECT ciphertext,url,auth_header FROM plugin_mcp_connections WHERE user_id=? AND id=?", userID(r), identifier).Scan(&cipher, &oldURL, &oldHeader)
		if oldURL != input.URL || oldHeader != input.Header {
			cipher = ""
		}
	}
	for _, name := range input.AutoApproved {
		if !plugin.Has(input.Selected, name) {
			return problem(400, "免确认工具必须已选中")
		}
		var rawTools string
		if e := s.db.QueryRowContext(r.Context(), "SELECT tools FROM plugin_mcp_connections WHERE user_id=? AND id=? AND url=? AND transport=? AND auth_header=?", userID(r), identifier, input.URL, input.Transport, input.Header).Scan(&rawTools); e != nil {
			return problem(400, "请先连接并发现工具")
		}
		var tools []object
		_ = json.Unmarshal([]byte(rawTools), &tools)
		found := false
		for _, tool := range tools {
			if str(tool["name"]) == name {
				found = true
			}
		}
		if !found {
			return problem(400, "免确认工具未发现")
		}
	}
	if input.AutoApproved == nil {
		input.AutoApproved = []string{}
	}
	selected, _ := json.Marshal(input.Selected)
	if input.Selected == nil {
		selected = []byte("[]")
	}
	_, err = s.db.ExecContext(r.Context(), `INSERT INTO plugin_mcp_connections(id,user_id,name,url,transport,auth_header,ciphertext,selected,auto_approved) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET name=excluded.name,url=excluded.url,transport=excluded.transport,auth_header=excluded.auth_header,ciphertext=excluded.ciphertext,selected=excluded.selected,auto_approved=excluded.auto_approved,tools=CASE WHEN plugin_mcp_connections.url<>excluded.url OR plugin_mcp_connections.transport<>excluded.transport THEN '[]' ELSE plugin_mcp_connections.tools END,generation=plugin_mcp_connections.generation+1`, identifier, userID(r), input.Name, input.URL, input.Transport, input.Header, cipher, string(selected), mustJSON(input.AutoApproved))
	if err != nil {
		return err
	}
	return success(w, object{"id": identifier})
}
func (s *Server) openMCP(r *http.Request, c mcpConnection) (*plugin.MCPSession, error) {
	var cipher string
	if err := s.db.QueryRowContext(r.Context(), "SELECT ciphertext FROM plugin_mcp_connections WHERE user_id=? AND id=?", userID(r), c.ID).Scan(&cipher); err != nil {
		return nil, err
	}
	secret := ""
	if cipher != "" {
		var err error
		secret, err = auth.Decrypt(cipher, s.config.EncryptionKey)
		if err != nil {
			return nil, err
		}
	}
	client := &plugin.MCPClient{Client: s.mcpHTTPClient(c.URL), URL: c.URL, Transport: c.Transport, Header: c.Header, Secret: secret}
	return client.Open(r.Context())
}
func (s *Server) refreshMCP(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	if err := s.requirePlugin(r, "markvault.mcp-client"); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	r = r.WithContext(ctx)
	list, err := s.mcpConnections(r)
	if err != nil {
		return err
	}
	for _, c := range list {
		if c.ID != chi.URLParam(r, "connectionId") {
			continue
		}
		session, e := s.openMCP(r, c)
		if e != nil {
			return problem(502, "MCP 连接失败，请检查地址和凭据")
		}
		defer session.Close()
		tools, e := session.Tools()
		if e != nil {
			return problem(502, "MCP 工具发现失败")
		}
		if err := validateMCPTools(tools); err != nil {
			return err
		}
		raw, _ := json.Marshal(tools)
		_, err = s.db.ExecContext(ctx, "UPDATE plugin_mcp_connections SET tools=?,generation=generation+1,auto_approved='[]' WHERE user_id=? AND id=? AND generation=?", string(raw), userID(r), c.ID, c.Generation)
		if err != nil {
			return err
		}
		s.watchMCP(r, c)
		return success(w, object{"tools": tools})
	}
	return problem(404, "连接不存在")
}
func connectionRevision(c mcpConnection, base string) string {
	raw, _ := json.Marshal(c.Tools)
	hash := sha256.Sum256(raw)
	return fmt.Sprintf("%s:%s:%d:%x", base, c.ID, c.Generation, hash[:8])
}
func (s *Server) externalTools(r *http.Request) ([]agentTool, error) {
	list, err := s.mcpConnections(r)
	if err != nil {
		return nil, err
	}
	st, err := s.plugins.Get(r.Context(), userID(r), "markvault.mcp-client")
	if err != nil {
		return nil, err
	}
	result := []agentTool{}
	for _, c := range list {
		s.watchMCP(r, c)
		for _, tool := range c.Tools {
			name := str(tool["name"])
			if !plugin.Has(c.Selected, name) {
				continue
			}
			schema, _ := tool["inputSchema"].(map[string]any)
			if schema == nil {
				continue
			}
			raw, _ := json.Marshal(schema)
			copy := object{}
			_ = json.Unmarshal(raw, &copy)
			props, _ := copy["properties"].(map[string]any)
			if props == nil {
				props = object{}
				copy["properties"] = props
			}
			props["confirm"] = object{"type": "boolean"}
			result = append(result, agentTool{Name: pluginToolName("mcp:"+c.ID, name), Title: c.Name + " / " + name, Description: str(tool["description"]), Schema: copy, Write: !plugin.Has(c.AutoApproved, name), PluginID: "markvault.mcp-client", Revision: connectionRevision(c, st.Revision)})
		}
	}
	return result, nil
}
func (s *Server) executeExternalTool(r *http.Request, name string, args object, revision string) (object, error) {
	if err := s.requirePlugin(r, "markvault.mcp-client"); err != nil {
		return nil, err
	}
	list, err := s.mcpConnections(r)
	if err != nil {
		return nil, err
	}
	st, err := s.plugins.Get(r.Context(), userID(r), "markvault.mcp-client")
	if err != nil {
		return nil, err
	}
	for _, c := range list {
		for _, tool := range c.Tools {
			local := str(tool["name"])
			if pluginToolName("mcp:"+c.ID, local) != name || !plugin.Has(c.Selected, local) {
				continue
			}
			if connectionRevision(c, st.Revision) != revision {
				return nil, problem(409, "MCP 连接已变化")
			}
			ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
			defer cancel()
			ctx, release := s.pluginRuntime.Track(ctx, userID(r), "markvault.mcp-client")
			defer release()
			session, e := s.openMCP(r.WithContext(ctx), c)
			if e != nil {
				return nil, problem(502, "MCP 连接失败")
			}
			defer session.Close()
			fresh, e := session.Tools()
			if e != nil {
				return nil, problem(502, "MCP 工具刷新失败")
			}
			if mustJSON(fresh) != mustJSON(c.Tools) {
				_, err = s.db.ExecContext(ctx, "UPDATE plugin_mcp_connections SET tools=?,generation=generation+1,auto_approved='[]' WHERE user_id=? AND id=? AND generation=?", mustJSON(fresh), userID(r), c.ID, c.Generation)
				if err != nil {
					return nil, err
				}
				return nil, problem(409, "远端工具定义已变化，请重新选择并确认")
			}
			values := object{}
			current, e := s.plugins.Get(ctx, userID(r), "markvault.mcp-client")
			if e != nil || current.Status != "running" || current.Revision != st.Revision {
				return nil, problem(409, "MCP 授权已变化")
			}
			for k, v := range args {
				if k != "confirm" {
					values[k] = v
				}
			}
			result, e := session.Call("tools/call", object{"name": local, "arguments": values})
			if e != nil {
				return nil, problem(502, "MCP 工具调用失败")
			}
			return result, nil
		}
	}
	return nil, problem(404, "MCP 工具不存在")
}

func validateMCPTools(tools []map[string]any) error {
	for _, tool := range tools {
		schema, ok := tool["inputSchema"].(map[string]any)
		if !ok || plugin.CheckSchema(schema, 0) != nil {
			return problem(400, "远端工具使用了不支持的参数约束")
		}
	}
	return nil
}
