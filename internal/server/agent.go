package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"markvault/internal/plugin"
)

type agentTool = plugin.Tool

func (s *Server) findTool(name string) (agentTool, bool) {
	for _, definition := range s.bundle.Tools() {
		if definition.Name == name {
			return definition, true
		}
	}
	return agentTool{}, false
}
func validateSchema(value any, schema object, path string) error {
	if choices, ok := schema["enum"].([]any); ok {
		found := false
		for _, choice := range choices {
			if fmt.Sprint(choice) == fmt.Sprint(value) {
				found = true
			}
		}
		if !found {
			return problem(400, path+" 不在允许范围内")
		}
	}
	if constant, ok := schema["const"]; ok && constant != value {
		return problem(400, path+" 必须明确确认")
	}
	kind := str(schema["type"])
	if kinds, ok := schema["type"].([]any); ok {
		kind = str(kinds[0])
		if value == nil {
			for _, k := range kinds {
				if k == "null" {
					return nil
				}
			}
		}
	}
	switch kind {
	case "object":
		obj, ok := value.(map[string]any)
		if !ok || obj == nil {
			return problem(400, path+" 必须为对象")
		}
		properties, _ := schema["properties"].(map[string]any)
		required, _ := schema["required"].([]any)
		for _, k := range required {
			if _, ok := obj[str(k)]; !ok {
				return problem(400, path+" 缺少字段 "+str(k))
			}
		}
		for k, v := range obj {
			definition, ok := properties[k]
			if !ok {
				if schema["additionalProperties"] == false {
					return problem(400, path+" 包含未知字段 "+k)
				}
				continue
			}
			sub, ok := definition.(map[string]any)
			if !ok {
				return problem(400, path+" Schema 无效")
			}
			if err := validateSchema(v, sub, path+"."+k); err != nil {
				return err
			}
		}
	case "string":
		text, ok := value.(string)
		if !ok {
			return problem(400, path+" 必须为字符串")
		}
		n := utf8.RuneCountInString(text)
		if minimum, ok := schema["minLength"].(float64); ok && n < int(minimum) {
			return problem(400, path+" 不能为空")
		}
		if maximum, ok := schema["maxLength"].(float64); ok && n > int(maximum) {
			return problem(400, path+" 过长")
		}
	case "boolean":
		if _, ok := value.(bool); !ok {
			return problem(400, path+" 必须为布尔值")
		}
	case "integer", "number":
		n, ok := value.(float64)
		if !ok || math.IsNaN(n) || math.IsInf(n, 0) || (kind == "integer" && math.Trunc(n) != n) {
			return problem(400, path+" 必须为有效数字")
		}
		if min, ok := schema["minimum"].(float64); ok && n < min {
			return problem(400, path+" 小于允许值")
		}
		if max, ok := schema["maximum"].(float64); ok && n > max {
			return problem(400, path+" 超过允许值")
		}
	case "array":
		values, ok := value.([]any)
		if !ok {
			return problem(400, path+" 必须为数组")
		}
		if max, ok := schema["maxItems"].(float64); ok && len(values) > int(max) {
			return problem(400, path+" 项目过多")
		}
		if sub, ok := schema["items"].(map[string]any); ok {
			for _, v := range values {
				if err := validateSchema(v, sub, path+"[]"); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

type capturedResponse struct {
	headers http.Header
	body    bytes.Buffer
	status  int
}

func (c *capturedResponse) Header() http.Header { return c.headers }
func (c *capturedResponse) WriteHeader(code int) {
	if c.status == 0 {
		c.status = code
	}
}
func (c *capturedResponse) Write(data []byte) (int, error) {
	if c.status == 0 {
		c.status = 200
	}
	return c.body.Write(data)
}
func (s *Server) invoke(r *http.Request, h handler, args object, query url.Values, identifier string) (object, error) {
	request := r.Clone(r.Context())
	address := *r.URL
	address.RawQuery = query.Encode()
	request.URL = &address
	route := chi.NewRouteContext()
	route.URLParams.Add("id", identifier)
	request = request.WithContext(context.WithValue(request.Context(), chi.RouteCtxKey, route))
	raw, err := json.Marshal(args)
	if err != nil {
		return nil, err
	}
	request.Body = io.NopCloser(bytes.NewReader(raw))
	request.ContentLength = int64(len(raw))
	response := &capturedResponse{headers: http.Header{}}
	if err = h(response, request); err != nil {
		return nil, err
	}
	if response.status == 204 {
		return object{"message": "操作已完成"}, nil
	}
	var envelope struct {
		Data object `json:"data"`
	}
	if err = json.Unmarshal(response.body.Bytes(), &envelope); err != nil {
		return nil, err
	}
	return envelope.Data, nil
}
func (s *Server) executeTool(r *http.Request, name string, args object, confirmed bool) (object, error) {
	started := time.Now()
	succeeded := false
	defer func() {
		source := "chat"
		if r.URL.Path == "/api/mcp" {
			source = "mcp"
		}
		operation := s.toolUsageOperation(name)
		if strings.HasPrefix(name, "plugin_") && len(name) == 39 {
			operation = name
		}
		s.recordAgentUsage(r, source, "tool", operation, started, succeeded)
	}()
	result, err := s.runAgentTool(r, name, args, confirmed)
	succeeded = err == nil
	return result, err
}

func (s *Server) runAgentTool(r *http.Request, name string, args object, confirmed bool) (object, error) {
	if strings.HasPrefix(name, "plugin_") {
		return s.executePluginTool(r, name, args, confirmed)
	}
	if err := s.requirePlugin(r, "markvault.tools"); err != nil {
		return nil, err
	}
	definition, ok := s.findTool(name)
	if !ok {
		return nil, problem(400, "未知工具")
	}
	if err := permit(r, definition.Permission); err != nil {
		return nil, err
	}
	if definition.Write && !confirmed {
		return nil, problem(409, "写操作需要用户确认")
	}
	if err := validateSchema(args, definition.Schema, "arguments"); err != nil {
		return nil, err
	}
	request, err := s.bundle.RunTool(name, args)
	if err != nil {
		return nil, problem(400, "未知工具")
	}
	if request.Operation == "createBookmark" {
		return s.saveBookmark(r, request.Body, true)
	}
	operations := map[string]handler{"me": s.me, "search": s.search, "listBookmarks": s.listBookmarks, "getBookmark": s.getBookmark, "updateBookmark": s.updateBookmark, "deleteBookmark": s.deleteBookmark, "restoreBookmark": s.restoreBookmark, "listTags": s.listTags, "getTag": s.getTag, "createTag": s.createTag, "updateTag": s.updateTag, "deleteTag": s.deleteTag}
	h := operations[request.Operation]
	if h == nil {
		return nil, problem(400, "未知业务操作")
	}
	return s.invoke(r, h, request.Body, request.Query, request.ID)
}
func (s *Server) getTag(w http.ResponseWriter, r *http.Request) error {
	if err := permit(r, "tags.read"); err != nil {
		return err
	}
	row, err := one(r, s.db, `SELECT t.*,COUNT(b.id) AS bookmark_count FROM tags t LEFT JOIN bookmark_tags bt ON bt.tag_id=t.id AND bt.user_id=t.user_id LEFT JOIN bookmarks b ON b.id=bt.bookmark_id AND b.user_id=t.user_id AND b.deleted_at IS NULL WHERE t.id=? AND t.user_id=? AND t.deleted_at IS NULL GROUP BY t.id`, id(r), userID(r))
	if err != nil {
		return err
	}
	return success(w, object{"tag": row})
}
func (s *Server) search(w http.ResponseWriter, r *http.Request) error {
	if err := permit(r, "bookmarks.read"); err != nil {
		return err
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" || len(q) > 2000 {
		return problem(400, "搜索词不能为空或过长")
	}
	limit := 20
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 100 {
			return problem(400, "结果数量需为 1–100")
		}
		limit = n
	}
	pattern := escapeLike(q)
	bookmarks, err := all(r, s.db, `SELECT b.* FROM bookmarks b WHERE b.user_id=? AND b.deleted_at IS NULL AND (b.title LIKE ? ESCAPE '!' OR b.description LIKE ? ESCAPE '!' OR b.url LIKE ? ESCAPE '!' OR EXISTS(SELECT 1 FROM bookmark_tags bt JOIN tags t ON t.id=bt.tag_id AND t.user_id=bt.user_id WHERE bt.bookmark_id=b.id AND bt.user_id=b.user_id AND t.deleted_at IS NULL AND t.name LIKE ? ESCAPE '!')) ORDER BY b.is_pinned DESC,b.created_at DESC,b.id DESC LIMIT ?`, userID(r), pattern, pattern, pattern, pattern, limit)
	if err != nil {
		return err
	}
	if err = s.decorateBookmarks(r, s.db, bookmarks); err != nil {
		return err
	}
	tags := []object{}
	if permit(r, "tags.read") == nil {
		tags, err = all(r, s.db, `SELECT t.id,t.name,t.color,t.icon,COUNT(b.id) AS bookmark_count FROM tags t LEFT JOIN bookmark_tags bt ON bt.tag_id=t.id AND bt.user_id=t.user_id LEFT JOIN bookmarks b ON b.id=bt.bookmark_id AND b.user_id=t.user_id AND b.deleted_at IS NULL WHERE t.user_id=? AND t.deleted_at IS NULL AND t.name LIKE ? ESCAPE '!' GROUP BY t.id ORDER BY t.name LIMIT ?`, userID(r), pattern, limit)
		if err != nil {
			return err
		}
	}
	return success(w, object{"query": q, "results": object{"bookmarks": bookmarks, "tags": tags}, "meta": object{"bookmark_count": len(bookmarks), "tag_count": len(tags)}})
}
func (s *Server) agentCapabilities(w http.ResponseWriter, r *http.Request) error {
	return success(w, s.bundle.Capabilities(shareOrigin(r)))
}
func (s *Server) mcp(w http.ResponseWriter, r *http.Request) error {
	if err := s.requirePlugin(r, "markvault.mcp-server"); err != nil {
		return err
	}
	if who(r).APIKeyID == "" {
		return problem(401, "MCP 需要 API Key")
	}
	if origin := r.Header.Get("Origin"); origin != "" {
		allowed := origin == shareOrigin(r)
		for _, value := range s.config.AllowedOrigins {
			if value == origin {
				allowed = true
			}
		}
		if !allowed {
			return problem(403, "不允许该跨域来源")
		}
	}
	var raw any
	if err := decode(w, r, &raw); err != nil {
		return reply(w, 400, object{"jsonrpc": "2.0", "id": nil, "error": object{"code": -32700, "message": "JSON 解析失败"}})
	}
	payload, status, err := s.bundle.MCP(raw, plugin.MCPHost{
		Tools:   func() ([]agentTool, error) { return s.availableTools(r) },
		Allowed: func(d agentTool) bool { return s.externalToolAllowed(r, d) },
		Execute: func(name string, args object, confirmed bool) (object, error) {
			return s.executeTool(r, name, args, confirmed)
		},
		InvalidCall: func(name string) { s.recordAgentUsage(r, "mcp", "tool", s.toolUsageOperation(name), time.Now(), false) },
		ErrorMessage: func(err error) string {
			if e, ok := err.(*httpError); ok {
				return e.message
			}
			s.log.Error("工具执行失败", "error", err)
			return "工具执行失败"
		},
	})
	if err != nil {
		return err
	}
	w.Header().Set("MCP-Protocol-Version", "2025-06-18")
	if status == 202 {
		w.WriteHeader(202)
		return nil
	}
	if status != 200 {
		return reply(w, status, payload)
	}
	accept := r.Header.Get("Accept")
	if strings.Contains(accept, "text/event-stream") && !strings.Contains(accept, "application/json") {
		w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache, no-transform")
		encoded, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		_, err = fmt.Fprintf(w, "event: message\ndata: %s\n\n", encoded)
		return err
	}
	return reply(w, 200, payload)
}
