package plugin

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

type MCPClient struct {
	Client    *http.Client
	URL       string
	Transport string
	Header    string
	Secret    string
}
type MCPSession struct {
	client    *MCPClient
	ctx       context.Context
	cancel    context.CancelFunc
	endpoint  string
	session   string
	sequence  int
	events    chan map[string]any
	stream    io.ReadCloser
	changed   chan struct{}
	lost      chan struct{}
	lostOnce  sync.Once
	closeOnce sync.Once
}

func (c *MCPClient) Open(ctx context.Context) (*MCPSession, error) {
	ctx, cancel := context.WithCancel(ctx)
	s := &MCPSession{client: c, ctx: ctx, cancel: cancel, endpoint: c.URL, changed: make(chan struct{}, 1), lost: make(chan struct{})}
	if c.Transport == "sse" {
		if err := s.openSSE(); err != nil {
			s.Close()
			return nil, err
		}
	}
	_, err := s.Call("initialize", map[string]any{"protocolVersion": "2025-03-26", "capabilities": map[string]any{}, "clientInfo": map[string]any{"name": "MarkVault", "version": "1.0.0"}})
	if err != nil {
		s.Close()
		return nil, err
	}
	if err = s.notify("notifications/initialized", map[string]any{}); err != nil {
		s.Close()
		return nil, err
	}
	return s, nil
}
func (s *MCPSession) request(method, address string, body io.Reader) (*http.Response, error) {
	return s.requestContext(s.ctx, method, address, body)
}
func (s *MCPSession) requestContext(ctx context.Context, method, address string, body io.Reader) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, address, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	if s.client.Header != "" {
		req.Header.Set(s.client.Header, s.client.Secret)
	}
	if s.session != "" {
		req.Header.Set("Mcp-Session-Id", s.session)
		req.Header.Set("MCP-Protocol-Version", "2025-03-26")
	}
	return s.client.Client.Do(req)
}
func (s *MCPSession) Close() {
	s.closeOnce.Do(func() {
		s.cancel()
		if s.stream != nil {
			s.stream.Close()
		}
		if s.session != "" {
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			req, err := http.NewRequestWithContext(ctx, "DELETE", s.endpoint, nil)
			if err == nil {
				req.Header.Set("Mcp-Session-Id", s.session)
				req.Header.Set("MCP-Protocol-Version", "2025-03-26")
				if s.client.Header != "" {
					req.Header.Set(s.client.Header, s.client.Secret)
				}
				if resp, err := s.client.Client.Do(req); err == nil {
					resp.Body.Close()
				}
			}
		}
		s.client.Client.CloseIdleConnections()
	})
}

// Watch 在初始化后订阅工具变化；不支持 GET 的 HTTP 服务保留定期发现能力。
func (s *MCPSession) Watch() error {
	if s.client.Transport == "sse" {
		return nil
	}
	resp, err := s.request("GET", s.endpoint, nil)
	if err != nil {
		return err
	}
	if resp.StatusCode == http.StatusMethodNotAllowed {
		resp.Body.Close()
		return nil
	}
	if resp.StatusCode != 200 || !strings.Contains(resp.Header.Get("Content-Type"), "text/event-stream") {
		resp.Body.Close()
		return errors.New("MCP 订阅失败")
	}
	s.stream = resp.Body
	go func() {
		defer resp.Body.Close()
		defer s.lostOnce.Do(func() { close(s.lost) })
		_ = readEvents(resp.Body, func(_ string, data string) bool {
			var message map[string]any
			if json.Unmarshal([]byte(data), &message) == nil {
				s.notification(message)
			}
			return s.ctx.Err() == nil
		})
	}()
	return nil
}
func (s *MCPSession) Changes() <-chan struct{} { return s.changed }
func (s *MCPSession) Lost() <-chan struct{}    { return s.lost }
func (s *MCPSession) notification(message map[string]any) bool {
	if message["method"] != "notifications/tools/list_changed" {
		return false
	}
	select {
	case s.changed <- struct{}{}:
	default:
	}
	return true
}
func (s *MCPSession) notify(method string, params any) error {
	raw, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "method": method, "params": params})
	resp, err := s.request("POST", s.endpoint, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return errors.New("MCP 通知失败")
	}
	return nil
}
func (s *MCPSession) Call(method string, params any) (map[string]any, error) {
	ctx, cancel := context.WithTimeout(s.ctx, 30*time.Second)
	defer cancel()
	s.sequence++
	id := s.sequence
	raw, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params})
	resp, err := s.requestContext(ctx, "POST", s.endpoint, bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, errors.New("MCP 请求失败")
	}
	if session := resp.Header.Get("Mcp-Session-Id"); session != "" {
		if len(session) > 256 {
			return nil, errors.New("MCP 会话无效")
		}
		s.session = session
	}
	var message map[string]any
	if s.events != nil {
		for {
			select {
			case item, ok := <-s.events:
				if !ok {
					return nil, errors.New("MCP 连接已断开")
				}
				if item["id"] == float64(id) {
					message = item
				}
			case <-ctx.Done():
				return nil, ctx.Err()
			}
			if message != nil {
				break
			}
		}
	} else if strings.Contains(resp.Header.Get("Content-Type"), "text/event-stream") {
		err = readEvents(resp.Body, func(event, data string) bool {
			var item map[string]any
			if json.Unmarshal([]byte(data), &item) == nil && item["id"] == float64(id) {
				message = item
				return false
			}
			return true
		})
		if err != nil {
			return nil, err
		}
	} else {
		data, e := io.ReadAll(io.LimitReader(resp.Body, 2<<20+1))
		if e != nil || len(data) > 2<<20 {
			return nil, errors.New("MCP 响应过大")
		}
		if json.Unmarshal(data, &message) != nil {
			return nil, errors.New("MCP 响应无效")
		}
	}
	if message == nil || message["id"] != float64(id) || message["jsonrpc"] != "2.0" {
		return nil, errors.New("MCP 响应不匹配")
	}
	if message["error"] != nil {
		return nil, errors.New("远端 MCP 返回错误")
	}
	result, ok := message["result"].(map[string]any)
	if !ok {
		return nil, errors.New("MCP 结果无效")
	}
	return result, nil
}
func (s *MCPSession) openSSE() error {
	resp, err := s.request("GET", s.client.URL, nil)
	if err != nil {
		return err
	}
	if resp.StatusCode != 200 {
		resp.Body.Close()
		return errors.New("MCP SSE 连接失败")
	}
	s.stream = resp.Body
	s.events = make(chan map[string]any, 32)
	ready := make(chan error, 1)
	go func() {
		defer close(s.events)
		defer s.lostOnce.Do(func() { close(s.lost) })
		endpointFound := false
		err := readEvents(resp.Body, func(event, data string) bool {
			if event == "endpoint" && !endpointFound {
				base, _ := url.Parse(s.client.URL)
				target, e := url.Parse(data)
				if e != nil {
					ready <- e
					return false
				}
				target = base.ResolveReference(target)
				if target.Scheme != base.Scheme || target.Host != base.Host || target.User != nil || target.Fragment != "" {
					ready <- errors.New("MCP SSE 端点不能跨来源")
					return false
				}
				s.endpoint = target.String()
				endpointFound = true
				ready <- nil
				return true
			}
			if event == "message" {
				var message map[string]any
				if json.Unmarshal([]byte(data), &message) == nil {
					if s.notification(message) {
						return true
					}
					select {
					case s.events <- message:
					case <-s.ctx.Done():
						return false
					}
				}
			}
			return true
		})
		if !endpointFound {
			if err == nil {
				err = errors.New("MCP SSE 缺少端点")
			}
			ready <- err
		}
	}()
	timer := time.NewTimer(10 * time.Second)
	defer timer.Stop()
	select {
	case <-timer.C:
		return errors.New("MCP SSE 初始化超时")
	case err := <-ready:
		return err
	case <-s.ctx.Done():
		return s.ctx.Err()
	}
}
func readEvents(reader io.Reader, receive func(string, string) bool) error {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 4096), 2<<20)
	event := ""
	data := []string{}
	size := 0
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			if len(data) > 0 && !receive(event, strings.Join(data, "\n")) {
				return nil
			}
			event = ""
			data = nil
			size = 0
			continue
		}
		if strings.HasPrefix(line, "event:") {
			event = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		}
		if strings.HasPrefix(line, "data:") {
			part := strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " ")
			size += len(part)
			if size > 2<<20 {
				return errors.New("SSE 事件过大")
			}
			data = append(data, part)
		}
	}
	return scanner.Err()
}
func (s *MCPSession) Tools() ([]map[string]any, error) {
	result := []map[string]any{}
	cursor := ""
	seen := map[string]bool{}
	for page := 0; page < 20; page++ {
		params := map[string]any{}
		if cursor != "" {
			params["cursor"] = cursor
		}
		response, err := s.Call("tools/list", params)
		if err != nil {
			return nil, err
		}
		items, ok := response["tools"].([]any)
		if !ok {
			return nil, errors.New("MCP 工具列表无效")
		}
		for _, item := range items {
			tool, ok := item.(map[string]any)
			if !ok {
				return nil, errors.New("MCP 工具定义无效")
			}
			name, _ := tool["name"].(string)
			if name == "" || len(name) > 128 || seen["tool:"+name] {
				return nil, errors.New("MCP 工具重名或无效")
			}
			seen["tool:"+name] = true
			result = append(result, tool)
			if len(result) > 256 {
				return nil, errors.New("MCP 工具数量超限")
			}
		}
		cursor, _ = response["nextCursor"].(string)
		if cursor == "" {
			return result, nil
		}
		if seen["cursor:"+cursor] {
			return nil, errors.New("MCP 分页循环")
		}
		seen["cursor:"+cursor] = true
	}
	return nil, fmt.Errorf("MCP 分页超过上限")
}
