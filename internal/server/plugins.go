package server

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"markvault/internal/auth"
	"markvault/internal/plugin"
)

func (s *Server) pluginRoutes(r chi.Router) {
	r.Get("/api/v1/plugins/image-hosting/settings", s.handle(s.imageHostingSettings))
	r.Put("/api/v1/plugins/image-hosting/settings", s.handle(s.imageHostingSettings))
	r.Post("/api/v1/plugins/image-hosting/default-image", s.handle(s.uploadDefaultImage))
	r.Delete("/api/v1/plugins/image-hosting/default-image", s.handle(s.deleteDefaultImage))
	r.Get("/api/v1/plugins/models", s.handle(s.pluginModels))
	r.Get("/api/v1/plugins/{pluginId}/credentials", s.handle(s.pluginCredentials))
	r.Put("/api/v1/plugins/{pluginId}/credentials", s.handle(s.pluginCredentials))
	r.Put("/api/v1/plugins/{pluginId}/exposure", s.handle(s.pluginExpose))
	r.Get("/api/v1/plugins/catalog", s.handle(s.pluginCatalog))
	r.Post("/api/v1/plugin-admin/catalog/refresh", s.handle(s.pluginCatalogRefresh))
	r.Post("/api/v1/plugin-admin/catalog/install", s.handle(s.pluginCatalogInstall))
	r.Get("/api/v1/plugins/tools", s.handle(s.pluginTools))
	r.Post("/api/v1/plugins/tools/call", s.handle(s.pluginToolCall))
	r.Get("/api/v1/plugins/mcp/connections", s.handle(s.mcpConnectionHandler))
	r.Post("/api/v1/plugins/mcp/connections", s.handle(s.mcpConnectionHandler))
	r.Put("/api/v1/plugins/mcp/connections/{connectionId}", s.handle(s.mcpConnectionHandler))
	r.Delete("/api/v1/plugins/mcp/connections/{connectionId}", s.handle(s.mcpConnectionHandler))
	r.Post("/api/v1/plugins/mcp/connections/{connectionId}/refresh", s.handle(s.refreshMCP))
	r.Get("/api/v1/plugins", s.handle(s.pluginList))
	r.Get("/api/v1/plugins/{pluginId}", s.handle(s.pluginDetail))
	r.Put("/api/v1/plugins/{pluginId}", s.handle(s.pluginSave))
	r.Delete("/api/v1/plugins/{pluginId}/data", s.handle(s.pluginClearData))
	r.Post("/api/v1/plugins/{pluginId}/rpc", s.handle(s.pluginRPC))
	r.Get("/api/v1/plugins/{pluginId}/assets/*", s.handle(s.pluginAsset))
	r.Post("/api/v1/plugin-admin/install", s.handle(s.pluginInstall))
	r.Post("/api/v1/plugin-admin/{pluginId}/{action}", s.handle(s.pluginAdmin))
}
func pluginID(r *http.Request) string { return chi.URLParam(r, "pluginId") }
func (s *Server) pluginList(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	list, err := s.plugins.List(r.Context(), userID(r))
	if err != nil {
		return err
	}
	admin, err := s.canManageSite(r)
	if err != nil {
		return err
	}
	return success(w, object{"plugins": list, "admin": admin, "apiVersion": plugin.APIVersion, "runtimeAvailable": s.plugins.RuntimeAvailable, "defaultBookmarkImage": s.defaultImageURL(r, list)})
}
func (s *Server) pluginDetail(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	st, err := s.plugins.Get(r.Context(), userID(r), pluginID(r))
	if err != nil {
		return err
	}
	return success(w, st)
}
func (s *Server) pluginSave(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	var input struct {
		Enabled bool     `json:"enabled"`
		Config  object   `json:"config"`
		Grants  []string `json:"grants"`
	}
	if err := decode(w, r, &input); err != nil {
		return err
	}
	if input.Config == nil {
		input.Config = object{}
	}
	if input.Grants == nil {
		input.Grants = []string{}
	}
	if len(mustJSON(input.Config)) > 64<<10 {
		return problem(400, "插件配置超过 64 KiB")
	}
	st, err := s.plugins.Get(r.Context(), userID(r), pluginID(r))
	if err != nil {
		return err
	}
	if st.Manifest.Settings != nil {
		if err = validateSchema(input.Config, st.Manifest.Settings, "config"); err != nil {
			return err
		}
	}
	if st.Manifest.ID == plugin.ImageHostingID && input.Enabled {
		if err := s.validateImageHosting(input.Config, input.Grants); err != nil {
			return err
		}
	}
	if input.Enabled && st.Manifest.ID == "markvault.models" && str(input.Config["providerId"]) != "" {
		parts := strings.SplitN(str(input.Config["providerId"]), "/", 2)
		if len(parts) != 2 {
			return problem(400, "模型供应商 ID 无效")
		}
		provider, e := s.plugins.Get(r.Context(), userID(r), parts[0])
		if e != nil || provider.Status != "running" {
			return problem(400, "模型供应商尚未启用")
		}
		found := false
		for _, c := range provider.Manifest.Contributes {
			if c.Kind == "provider" && c.ID == parts[1] {
				found = true
			}
		}
		if !found {
			return problem(400, "模型供应商不存在")
		}
	}
	if err = s.plugins.Save(r.Context(), userID(r), pluginID(r), input.Enabled, input.Config, input.Grants); err != nil {
		return problem(400, err.Error())
	}
	s.stopPlugins(userID(r), pluginID(r))
	return s.pluginDetail(w, r)
}
func (s *Server) pluginInstall(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	if err := s.requireSiteAdmin(r); err != nil {
		return err
	}
	var raw []byte
	var err error
	source := "offline"
	if strings.HasPrefix(r.Header.Get("Content-Type"), "application/zip") {
		r.Body = http.MaxBytesReader(w, r.Body, plugin.MaxArchive)
		raw, err = io.ReadAll(r.Body)
	} else {
		var input struct {
			URL    string `json:"url"`
			SHA256 string `json:"sha256"`
		}
		if err = decode(w, r, &input); err != nil {
			return err
		}
		u, e := url.Parse(input.URL)
		if e != nil || u.Scheme != "https" || u.Host != "github.com" || !strings.Contains(u.Path, "/releases/download/") || strings.Contains(u.Path, "/latest/") {
			return problem(400, "必须使用固定 GitHub Release ZIP 资产地址")
		}
		raw, err = s.pluginDownload(r.Context(), input.URL)
		source = input.URL
		if err == nil && input.SHA256 != "" {
			p, e := plugin.ReadPackage(raw)
			if e != nil || !strings.EqualFold(p.Digest, input.SHA256) {
				return problem(400, "插件摘要不匹配")
			}
		}
	}
	if err != nil {
		return problem(400, "读取插件包失败")
	}
	p, err := plugin.ReadPackage(raw)
	if err != nil {
		return problem(400, err.Error())
	}
	err = s.plugins.Install(r.Context(), userID(r), p, source, func(value, schema map[string]any) error { return validateSchema(value, schema, "config") })
	if err != nil {
		return problem(400, err.Error())
	}
	s.stopPlugins("", p.Manifest.ID)
	return success(w, object{"id": p.Manifest.ID, "version": p.Manifest.Version, "digest": p.Digest})
}
func (s *Server) pluginAdmin(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	if err := s.requireSiteAdmin(r); err != nil {
		return err
	}
	if err := s.plugins.Admin(r.Context(), userID(r), pluginID(r), chi.URLParam(r, "action")); err != nil {
		return problem(400, err.Error())
	}
	s.stopPlugins("", pluginID(r))
	return success(w, object{"updated": true})
}
func (s *Server) pluginClearData(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	if pluginID(r) == "markvault.passkey" {
		return problem(409, "请在通行密钥设置中验证密码后逐项删除密钥")
	}
	st, err := s.plugins.Get(r.Context(), userID(r), pluginID(r))
	if err != nil {
		return err
	}
	if st.Enabled {
		return problem(409, "请先停用插件")
	}
	err = transaction(r.Context(), s.db, func(tx *sql.Tx) error {
		if pluginID(r) == plugin.ImageHostingID {
			if _, err := tx.ExecContext(r.Context(), "DELETE FROM plugin_default_images WHERE user_id=?", userID(r)); err != nil {
				return err
			}
		}
		for _, table := range []string{"plugin_storage", "plugin_credentials", "plugin_config_snapshots", "plugin_tool_confirmations"} {
			if _, err := tx.ExecContext(r.Context(), "DELETE FROM "+table+" WHERE user_id=? AND plugin_id=?", userID(r), pluginID(r)); err != nil {
				return err
			}
		}
		_, err := tx.ExecContext(r.Context(), "UPDATE plugin_users SET config='{}',grants='[]',exposed_tools='[]',generation=generation+1 WHERE user_id=? AND plugin_id=?", userID(r), pluginID(r))
		return err
	})
	if err != nil {
		return err
	}
	s.drainGarbage(r.Context())
	return success(w, object{"cleared": true})
}
func (s *Server) requirePlugin(r *http.Request, id string) error {
	st, err := s.plugins.Get(r.Context(), userID(r), id)
	if err != nil {
		return err
	}
	if st.Status != "running" {
		return problem(409, "插件不可用: "+id)
	}
	return nil
}
func (s *Server) pluginAsset(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	st, err := s.plugins.Get(r.Context(), userID(r), pluginID(r))
	if err != nil {
		return err
	}
	if st.Status != "running" {
		return problem(409, "插件尚未启用")
	}
	p, err := s.plugins.Archive(r.Context(), st.Manifest.ID, st.Manifest.Version)
	if err != nil {
		return err
	}
	name := chi.URLParam(r, "*")
	raw, ok := p.Files[name]
	if !ok || !plugin.SafePath(name) {
		return problem(404, "资源不存在")
	}
	// 资源作为 JSON 返回，浏览器宿主注入带独立 CSP 的 srcdoc，避免同源脚本执行。
	return success(w, object{"content": base64.StdEncoding.EncodeToString(raw), "revision": st.Revision})
}
func (s *Server) pluginRPC(w http.ResponseWriter, r *http.Request) error {
	if err := jwtOnly(r); err != nil {
		return err
	}
	var input struct {
		Method   string `json:"method"`
		Args     object `json:"args"`
		Revision string `json:"revision"`
	}
	if err := decode(w, r, &input); err != nil {
		return err
	}
	if err := s.rate(r, w, "plugin-rpc:"+userID(r)+":"+pluginID(r), 300, 60); err != nil {
		return err
	}
	st, err := s.plugins.Get(r.Context(), userID(r), pluginID(r))
	if err != nil {
		return err
	}
	if st.Status != "running" || st.Revision != input.Revision {
		return problem(409, "插件状态已变化，请重新加载")
	}
	result, err := s.pluginBroker(r, st, false)(r.Context(), input.Method, input.Args)
	if err != nil {
		return err
	}
	return success(w, object{"value": result})
}
func (s *Server) pluginBroker(r *http.Request, st plugin.State, confirmed bool) plugin.Broker {
	return func(ctx context.Context, method string, args map[string]any) (any, error) {
		current, err := s.plugins.Get(ctx, userID(r), st.Manifest.ID)
		if err != nil {
			return nil, err
		}
		if current.Status != "running" || current.Revision != st.Revision {
			return nil, problem(409, "插件授权已失效")
		}
		require := func(p string) error {
			if !plugin.Has(st.Grants, p) {
				return problem(403, "插件缺少权限: "+p)
			}
			if strings.HasPrefix(p, "storage.") || p == "network.fetch" {
				return nil
			}
			if p == "models.call" {
				return permit(r, "ai.suggest")
			}
			if strings.HasSuffix(p, ".write") {
				return nil
			}
			return permit(r, p)
		}
		switch method {
		case "config":
			return st.Config, nil
		case "storage.get", "storage.set":
			permission := "storage.read"
			if method == "storage.set" {
				permission = "storage.write"
			}
			if err = require(permission); err != nil {
				return nil, err
			}
			key := str(args["key"])
			if len(key) == 0 || len(key) > 128 {
				return nil, problem(400, "存储键无效")
			}
			if method == "storage.get" {
				var raw string
				err = s.db.QueryRowContext(ctx, "SELECT value FROM plugin_storage WHERE user_id=? AND plugin_id=? AND key=?", userID(r), st.Manifest.ID, key).Scan(&raw)
				if errors.Is(err, sql.ErrNoRows) {
					return nil, nil
				}
				if err != nil {
					return nil, err
				}
				var value any
				err = json.Unmarshal([]byte(raw), &value)
				return value, err
			}
			raw, e := json.Marshal(args["value"])
			if e != nil || len(raw) > 64<<10 {
				return nil, problem(400, "存储值超过 64 KiB")
			}
			err = transaction(ctx, s.db, func(tx *sql.Tx) error {
				var total int
				if err := tx.QueryRowContext(ctx, "SELECT COALESCE(SUM(length(CAST(value AS BLOB))),0) FROM plugin_storage WHERE user_id=? AND plugin_id=? AND key<>?", userID(r), st.Manifest.ID, key).Scan(&total); err != nil {
					return err
				}
				if total+len(raw) > 1<<20 {
					return problem(413, "插件存储超过 1 MiB")
				}
				_, err := tx.ExecContext(ctx, `INSERT INTO plugin_storage(user_id,plugin_id,key,value) VALUES(?,?,?,?) ON CONFLICT(user_id,plugin_id,key) DO UPDATE SET value=excluded.value`, userID(r), st.Manifest.ID, key, string(raw))
				return err
			})
			return true, err
		case "business.call":
			tool := str(args["tool"])
			definition, ok := s.findTool(tool)
			if !ok {
				return nil, problem(400, "未知业务工具")
			}
			permission := definition.Permission
			if definition.Write {
				permission = strings.Split(permission, ".")[0] + ".write"
			}
			if err = require(permission); err != nil {
				return nil, err
			}
			if definition.Write && !confirmed {
				return nil, problem(409, "写操作需要确认")
			}
			arguments, _ := args["args"].(map[string]any)
			if arguments == nil {
				arguments = object{}
			}
			if confirmed {
				arguments["confirm"] = true
			}
			return s.executeTool(r.WithContext(ctx), tool, arguments, confirmed)
		case "network.fetch":
			if err = require("network.fetch"); err != nil {
				return nil, err
			}
			rawURL := str(args["url"])
			method := str(args["method"])
			if method == "" {
				method = "GET"
			}
			if method != "GET" && method != "POST" {
				return nil, problem(400, "网络代理只支持 GET 和 POST")
			}
			body := str(args["body"])
			if len(body) > 1<<20 {
				return nil, problem(400, "网络请求过大")
			}
			req, e := http.NewRequestWithContext(ctx, method, rawURL, strings.NewReader(body))
			if e != nil {
				return nil, problem(400, "网络地址无效")
			}
			if e = pluginTarget(req.URL); e != nil {
				return nil, e
			}
			if method == "POST" {
				req.Header.Set("Content-Type", "application/json")
			}
			if reference := str(args["credential"]); reference != "" {
				var target, cipher string
				err = s.db.QueryRowContext(ctx, "SELECT target,ciphertext FROM plugin_credentials WHERE user_id=? AND plugin_id=? AND name=?", userID(r), st.Manifest.ID, reference).Scan(&target, &cipher)
				if err != nil {
					return nil, err
				}
				if target != req.URL.Scheme+"://"+req.URL.Host {
					return nil, problem(403, "凭据目标不匹配")
				}
				secret, e := auth.Decrypt(cipher, s.config.EncryptionKey)
				if e != nil {
					return nil, e
				}
				req.Header.Set("Authorization", "Bearer "+secret)
			}
			client := pluginHTTPClient()
			defer client.CloseIdleConnections()
			response, e := client.Do(req)
			if e != nil {
				return nil, problem(502, "插件网络请求失败")
			}
			defer response.Body.Close()
			raw, e := io.ReadAll(io.LimitReader(response.Body, 1<<20+1))
			if e != nil || len(raw) > 1<<20 {
				return nil, problem(502, "响应过大")
			}
			return object{"status": response.StatusCode, "body": string(raw)}, nil
		case "models.call":
			if err = require("models.call"); err != nil {
				return nil, err
			}
			if err = s.requirePlugin(r, "markvault.models"); err != nil {
				return nil, err
			}
			settings, e := s.loadAI(r)
			if e != nil {
				return nil, e
			}
			raw, _ := json.Marshal(args["messages"])
			var messages []conversationMessage
			if json.Unmarshal(raw, &messages) != nil || len(messages) == 0 || len(messages) > 30 {
				return nil, problem(400, "消息格式无效")
			}
			text, _, e := s.selectedModel(r.WithContext(ctx), settings, s.bundle.SystemPrompt, messages, nil)
			return object{"content": text}, e
		default:
			return nil, problem(400, "不支持的插件 SDK 方法")
		}
	}
}
func pluginTarget(u *url.URL) error {
	if u == nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Fragment != "" {
		return problem(400, "插件只允许访问 HTTPS 目标")
	}
	return nil
}
func pluginPublicIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}
	for _, cidr := range []string{"0.0.0.0/8", "100.64.0.0/10", "192.0.0.0/24", "192.0.2.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4", "64:ff9b::/96", "64:ff9b:1::/48", "100::/64", fmt.Sprintf("%x::/%d", 0x2001, 32), "2001:db8::/32", fmt.Sprintf("%x::/%d", 0x2002, 16)} {
		if netip.MustParsePrefix(cidr).Contains(ip) {
			return false
		}
	}
	return true
}
func pluginHTTPClient() *http.Client {
	transport := &http.Transport{TLSHandshakeTimeout: 10 * time.Second, ResponseHeaderTimeout: 20 * time.Second, MaxIdleConns: 4, IdleConnTimeout: 10 * time.Second}
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
		if err != nil || len(ips) == 0 {
			return nil, errors.New("目标解析失败")
		}
		for _, ip := range ips {
			if !pluginPublicIP(ip) {
				return nil, errors.New("禁止访问非公网目标")
			}
		}
		dialer := net.Dialer{Timeout: 10 * time.Second}
		return dialer.DialContext(ctx, network, net.JoinHostPort(ips[0].String(), port))
	}
	return &http.Client{Transport: transport, Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("不允许重定向") }}
}
func (s *Server) pluginDownload(ctx context.Context, address string) ([]byte, error) {
	client := pluginHTTPClient()
	defer client.CloseIdleConnections()
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) > 3 {
			return errors.New("重定向次数超限")
		}
		if err := pluginTarget(req.URL); err != nil {
			return err
		}
		if !plugin.Has([]string{"github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"}, req.URL.Hostname()) {
			return errors.New("禁止跨目标重定向")
		}
		req.Header.Del("Authorization")
		return nil
	}
	req, err := http.NewRequestWithContext(ctx, "GET", address, nil)
	if err != nil {
		return nil, err
	}
	if err = pluginTarget(req.URL); err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, errors.New("插件下载失败")
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, plugin.MaxArchive+1))
	if len(raw) > plugin.MaxArchive {
		return nil, errors.New("插件包过大")
	}
	return raw, err
}
