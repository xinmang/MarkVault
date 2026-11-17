package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"

	"markvault/internal/auth"
	"markvault/internal/plugin"
)

type aiSettings = plugin.ModelSettings

func (s *Server) loadAI(r *http.Request) (aiSettings, error) {
	settings := aiSettings{Provider: "openai", Model: s.bundle.Providers["openai"][1]}
	row, err := one(r, s.db, "SELECT * FROM ai_settings WHERE user_id=?", userID(r))
	if errors.Is(err, sql.ErrNoRows) {
		return settings, nil
	}
	if err != nil {
		return settings, err
	}
	settings.Provider = str(row["provider"])
	if _, ok := s.bundle.Providers[settings.Provider]; !ok {
		settings.Provider = "openai"
	}
	settings.URL = str(row["api_urls"])
	settings.Model = str(row["model"])
	if settings.Model == "" {
		settings.Model = s.bundle.Providers[settings.Provider][1]
	}
	settings.Prompt = str(row["custom_prompt"])
	settings.Custom = boolean(row["enable_custom_prompt"])
	settings.Enabled = boolean(row["enabled"])
	settings.Created = row["created_at"]
	settings.Updated = row["updated_at"]
	if encrypted := str(row["api_keys_encrypted"]); encrypted != "" {
		settings.Key, err = auth.Decrypt(encrypted, s.config.EncryptionKey)
		if err != nil {
			return settings, err
		}
	}
	settings.HasKey = settings.Key != ""
	return settings, nil
}
func publicIP(address netip.Addr) bool {
	address = address.Unmap()
	if !address.IsGlobalUnicast() || address.IsPrivate() || address.IsLoopback() || address.IsLinkLocalUnicast() {
		return false
	}
	for _, prefix := range []string{"0.0.0.0/8", "100.64.0.0/10", "192.0.0.0/24", "192.0.2.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4", "64:ff9b::/96", "64:ff9b:1::/48", "100::/64", "2001::/32", "2001:db8::/32", "2002::/16"} {
		if netip.MustParsePrefix(prefix).Contains(address) {
			return false
		}
	}
	return true
}
func (s *Server) aiBaseURL(raw string) (string, error) {
	raw = strings.TrimRight(strings.TrimSpace(raw), "/")
	for _, suffix := range []string{"/chat/completions", "/messages"} {
		raw = strings.TrimSuffix(raw, suffix)
	}
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", problem(400, "AI 地址必须为不含凭据、查询和片段的 HTTP/HTTPS 网址")
	}
	host := strings.ToLower(u.Hostname())
	if !s.config.AllowPrivateAI {
		if address, err := netip.ParseAddr(host); err == nil {
			if !publicIP(address) {
				return "", problem(400, "实例未允许访问内网 AI 地址")
			}
		} else if !strings.Contains(host, ".") || host == "localhost" || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".internal") || strings.HasSuffix(host, ".lan") || strings.HasSuffix(host, ".home.arpa") {
			return "", problem(400, "实例未允许访问内网 AI 地址")
		}
	}
	return raw, nil
}
func (s *Server) aiHTTPClient() *http.Client {
	// 连接时重新校验并绑定解析结果，避免 DNS 重绑定和环境代理绕过地址限制。
	transport := &http.Transport{MaxIdleConns: 4, IdleConnTimeout: 30 * time.Second, TLSHandshakeTimeout: 10 * time.Second, ResponseHeaderTimeout: 45 * time.Second}
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		addresses, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
		if err != nil {
			return nil, errors.New("AI 服务域名解析失败")
		}
		if len(addresses) == 0 {
			return nil, errors.New("AI 服务域名无可用地址")
		}
		if !s.config.AllowPrivateAI {
			for _, ip := range addresses {
				if !publicIP(ip) {
					return nil, errors.New("AI 服务解析到了禁止访问的地址")
				}
			}
		}
		var last error
		dialer := net.Dialer{Timeout: 10 * time.Second}
		for _, ip := range addresses {
			conn, err := dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
			if err == nil {
				return conn, nil
			}
			last = err
		}
		return nil, last
	}
	return &http.Client{Transport: transport, Timeout: 60 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("AI 服务不允许重定向") }}
}
func (s *Server) aiSettingsHandler(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	current, err := s.loadAI(r)
	if err != nil {
		return err
	}
	if r.Method == "GET" {
		if st, e := s.plugins.Get(r.Context(), userID(r), "markvault.models"); e == nil {
			current.HasPluginProvider = st.Status == "running" && str(st.Config["providerId"]) != ""
		}
		return success(w, object{"settings": current})
	}
	var input struct {
		aiSettings
		APIKey string `json:"apiKey"`
		Clear  bool   `json:"clearApiKey"`
	}
	if err = decode(w, r, &input); err != nil {
		return err
	}
	defaults, ok := s.bundle.Providers[input.Provider]
	if !ok {
		return problem(400, "不支持的 AI 服务商")
	}
	if len(input.URL) > 2000 || len(input.Model) > 200 || len(input.Prompt) > 16000 || len(input.APIKey) > 8192 || strings.ContainsAny(input.APIKey, "\r\n") {
		return problem(400, "AI 设置过长或密钥包含无效字符")
	}
	if input.URL != "" {
		input.URL, err = s.aiBaseURL(input.URL)
		if err != nil {
			return err
		}
	}
	if input.Provider == "custom" && input.URL == "" {
		return problem(400, "自定义服务必须填写 AI 地址")
	}
	input.Model = strings.TrimSpace(input.Model)
	if input.Model == "" {
		input.Model = defaults[1]
	}
	if input.Model == "" {
		return problem(400, "必须填写模型名称")
	}
	key := current.Key
	if input.Clear {
		key = ""
	} else if strings.TrimSpace(input.APIKey) != "" {
		key = strings.TrimSpace(input.APIKey)
	}
	if input.Enabled && key == "" {
		return problem(400, "启用 AI 前必须配置密钥")
	}
	var encrypted any
	if key != "" {
		encrypted, err = auth.Encrypt(key, s.config.EncryptionKey)
		if err != nil {
			return err
		}
	}
	_, err = s.db.ExecContext(r.Context(), `INSERT INTO ai_settings(user_id,provider,api_keys_encrypted,api_urls,model,custom_prompt,enable_custom_prompt,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET provider=excluded.provider,api_keys_encrypted=excluded.api_keys_encrypted,api_urls=excluded.api_urls,model=excluded.model,custom_prompt=excluded.custom_prompt,enable_custom_prompt=excluded.enable_custom_prompt,enabled=excluded.enabled,updated_at=excluded.updated_at`, userID(r), input.Provider, encrypted, nullable(input.URL), input.Model, nullable(input.Prompt), input.Custom, input.Enabled, now(), now())
	if err != nil {
		return err
	}
	updated, err := s.loadAI(r)
	if err != nil {
		return err
	}
	return success(w, object{"settings": updated})
}

type modelCall = plugin.ModelCall
type conversationMessage = plugin.Message

func (s *Server) modelHost() plugin.ModelHost {
	return plugin.ModelHost{BaseURL: s.aiBaseURL, Client: s.aiHTTPClient, Error: problem, NewID: auth.ID}
}
func (s *Server) callModel(ctx context.Context, settings aiSettings, system string, messages []conversationMessage, definitions []agentTool) (string, []modelCall, error) {
	return s.bundle.Model.Chat(ctx, s.modelHost(), settings, system, messages, definitions)
}
func (s *Server) aiTest(w http.ResponseWriter, r *http.Request) error {
	if err := s.requirePlugin(r, "markvault.models"); err != nil {
		return err
	}
	if err := jwtOnly(r); err != nil {
		return err
	}
	if err := s.rate(r, w, "ai:"+userID(r), 20, 60); err != nil {
		return err
	}
	settings, err := s.loadAI(r)
	if err != nil {
		return err
	}
	start := time.Now()
	_, _, err = s.selectedModel(r, settings, "只回复 OK。", []conversationMessage{{Role: "user", Content: "ping"}}, nil)
	if err != nil {
		return err
	}
	return success(w, object{"connected": true, "latency": time.Since(start).Milliseconds(), "model": settings.Model})
}

func (s *Server) agentChat(w http.ResponseWriter, r *http.Request) error {
	if err := s.requirePlugin(r, "markvault.agent"); err != nil {
		return err
	}
	if err := s.requirePlugin(r, "markvault.models"); err != nil {
		return err
	}
	if err := jwtOnly(r); err != nil {
		return err
	}
	if err := s.rate(r, w, "ai:"+userID(r), 20, 60); err != nil {
		return err
	}
	var input struct {
		AgentID  string `json:"agentId"`
		Messages []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"messages"`
	}
	if err := decode(w, r, &input); err != nil {
		return err
	}
	if len(input.Messages) < 1 || len(input.Messages) > 30 {
		return problem(400, "消息数量需为 1–30")
	}
	if input.AgentID != "" && input.AgentID != "markvault.agent" {
		return s.pluginAgentChat(w, r, input.AgentID, input)
	}
	conversation := []conversationMessage{}
	for _, message := range input.Messages {
		if (message.Role != "user" && message.Role != "assistant") || strings.TrimSpace(message.Content) == "" {
			return problem(400, "聊天消息格式无效")
		}
		runes := []rune(message.Content)
		if len(runes) > 8000 {
			runes = runes[:8000]
		}
		conversation = append(conversation, conversationMessage{Role: message.Role, Content: string(runes)})
	}
	settings, err := s.loadAI(r)
	if err != nil {
		return err
	}
	providerState, err := s.plugins.Get(r.Context(), userID(r), "markvault.models")
	if err != nil {
		return err
	}
	if str(providerState.Config["providerId"]) == "" && (!settings.Enabled || !settings.HasKey) {
		return problem(400, "请先在设置中配置并启用 AI")
	}
	ctx, cancel := context.WithTimeout(r.Context(), 100*time.Second)
	defer cancel()
	r = r.WithContext(ctx)
	rounds := s.config.AIChatMaxRounds
	if rounds < 1 {
		rounds = 6
	}
	result, err := s.bundle.Agent.Chat(ctx, plugin.AgentHost{
		Tools: func() ([]agentTool, error) { return s.availableTools(r) },
		Model: func(system string, messages []conversationMessage, definitions []agentTool) (string, []modelCall, error) {
			return s.selectedModel(r, settings, system, messages, definitions)
		},
		Execute:  func(name string, args object) (object, error) { return s.executeTool(r, name, args, false) },
		Validate: validateSchema,
		Confirm: func(pending []object) error {
			expires := time.Now().UTC().Add(10 * time.Minute).Format(time.RFC3339Nano)
			err := transaction(ctx, s.db, func(tx *sql.Tx) error {
				if _, err := tx.ExecContext(ctx, "DELETE FROM agent_pending_actions WHERE user_id=? AND (used_at IS NOT NULL OR expires_at<=?)", userID(r), now()); err != nil {
					return err
				}
				for _, action := range pending {
					token := auth.ID()
					encoded, _ := json.Marshal(action["arguments"])
					if _, err := tx.ExecContext(ctx, `INSERT INTO agent_pending_actions(id,user_id,tool_call_id,tool_name,arguments_json,title,summary,destructive,expires_at,created_at,plugin_revision) VALUES(?,?,?,?,?,?,?,?,?,?,?)`, token, userID(r), action["id"], action["name"], string(encoded), action["title"], action["summary"], action["destructive"], expires, now(), str(action["plugin_revision"])); err != nil {
						return err
					}
					action["confirmation_token"] = token
					action["expires_at"] = expires
				}
				return nil
			})
			if err != nil {
				return err
			}
			return nil
		},
		ErrorMessage: func(err error) string {
			if e, ok := err.(*httpError); ok {
				return e.message
			}
			return "工具执行失败"
		},
	}, settings, conversation, rounds)
	if err != nil {
		return err
	}
	return success(w, result)
}
func (s *Server) confirmAgent(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	if err := s.rate(r, w, "ai:"+userID(r), 20, 60); err != nil {
		return err
	}
	var input struct {
		Token string `json:"confirmation_token"`
	}
	if err := decode(w, r, &input); err != nil {
		return err
	}
	if input.Token == "" || len(input.Token) > 128 {
		return problem(400, "缺少有效确认凭证")
	}
	var action object
	err := transaction(r.Context(), s.db, func(tx *sql.Tx) error {
		var err error
		action, err = one(r, tx, "SELECT * FROM agent_pending_actions WHERE id=? AND user_id=? AND used_at IS NULL AND expires_at>?", input.Token, userID(r), now())
		if errors.Is(err, sql.ErrNoRows) {
			return problem(409, "操作已处理、凭证无效或过期")
		}
		if err != nil {
			return err
		}
		return affected(tx.ExecContext(r.Context(), "UPDATE agent_pending_actions SET used_at=? WHERE id=? AND user_id=? AND used_at IS NULL AND expires_at>?", now(), input.Token, userID(r), now()))
	})
	if err != nil {
		return err
	}
	if strings.HasSuffix(r.URL.Path, "/cancel") {
		return success(w, object{"message": "操作已取消"})
	}
	definitions, err := s.availableTools(r)
	if err != nil {
		return err
	}
	definition, ok := findDefinition(definitions, str(action["tool_name"]))
	if definition.Revision != str(action["plugin_revision"]) {
		return problem(409, "插件版本或授权已变更，请重新确认")
	}
	if !ok {
		return problem(400, "不支持的写操作")
	}
	args := object{}
	if err = json.Unmarshal([]byte(str(action["arguments_json"])), &args); err != nil {
		return err
	}
	if definition.Write {
		args["confirm"] = true
	}
	r = r.WithContext(context.WithValue(r.Context(), expectedPluginRevision{}, str(action["plugin_revision"])))
	result, err := s.executeTool(r, definition.Name, args, true)
	if err != nil {
		return err
	}
	return success(w, object{"action": object{"name": definition.Name, "title": definition.Title, "summary": action["summary"]}, "result": result, "data_changed": true, "message": definition.Title + "已完成。"})
}
