package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestMCPHTTPPaginationAndSession(t *testing.T) {
	closed := false
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-secret" {
			t.Error("凭据错误")
		}
		if r.Method == "DELETE" {
			closed = true
			w.WriteHeader(204)
			return
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		result := map[string]any{}
		switch body["method"] {
		case "initialize":
			w.Header().Set("Mcp-Session-Id", "test-session")
			result["protocolVersion"] = "2025-03-26"
		case "notifications/initialized":
			w.WriteHeader(202)
			return
		case "tools/list":
			if r.Header.Get("Mcp-Session-Id") != "test-session" {
				t.Error("会话未延续")
			}
			params, _ := body["params"].(map[string]any)
			name := "one"
			if params["cursor"] == nil {
				result["nextCursor"] = "second"
			} else {
				name = "two"
			}
			result["tools"] = []any{map[string]any{"name": name, "inputSchema": map[string]any{"type": "object"}}}
		case "tools/call":
			result["content"] = []any{map[string]any{"type": "text", "text": "ok"}}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": body["id"], "result": result})
	}))
	defer upstream.Close()
	client := &MCPClient{Client: upstream.Client(), URL: upstream.URL, Transport: "http", Header: "Authorization", Secret: "Bearer test-secret"}
	session, err := client.Open(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	tools, err := session.Tools()
	if err != nil || len(tools) != 2 {
		t.Fatal(tools, err)
	}
	if _, err = session.Call("tools/call", map[string]any{"name": "one"}); err != nil {
		t.Fatal(err)
	}
	session.Close()
	if !closed {
		t.Fatal("未清理 MCP 会话")
	}
}
func TestMCPSSEAndOriginBoundary(t *testing.T) {
	for _, cross := range []bool{false, true} {
		t.Run(fmt.Sprint(cross), func(t *testing.T) {
			messages := make(chan string, 8)
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == "GET" {
					w.Header().Set("Content-Type", "text/event-stream")
					endpoint := "/messages"
					if cross {
						endpoint = "https://other.example/messages"
					}
					_, _ = fmt.Fprintf(w, "event: endpoint\ndata: %s\n\n", endpoint)
					w.(http.Flusher).Flush()
					for {
						select {
						case data := <-messages:
							_, _ = fmt.Fprintf(w, "event: message\ndata: %s\n\n", data)
							w.(http.Flusher).Flush()
						case <-r.Context().Done():
							return
						}
					}
				}
				var body map[string]any
				_ = json.NewDecoder(r.Body).Decode(&body)
				if strings.HasPrefix(fmt.Sprint(body["method"]), "notifications/") {
					w.WriteHeader(202)
					return
				}
				result := map[string]any{"tools": []any{map[string]any{"name": "test", "inputSchema": map[string]any{"type": "object"}}}}
				raw, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": body["id"], "result": result})
				messages <- string(raw)
				w.WriteHeader(202)
			}))
			defer upstream.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			client := &MCPClient{Client: upstream.Client(), URL: upstream.URL, Transport: "sse"}
			session, err := client.Open(ctx)
			if cross {
				if err == nil {
					session.Close()
					t.Fatal("允许跨目标 SSE 端点")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			defer session.Close()
			tools, err := session.Tools()
			if err != nil || len(tools) != 1 {
				t.Fatal(tools, err)
			}
		})
	}
}
