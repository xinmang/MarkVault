package plugins

import (
	"encoding/json"
	"markvault/internal/plugin"
)

func AgentCapabilities(origin string) object {
	return object{"name": "MarkVault Agent API", "version": "1.1.0", "mode": "read-write", "authentication": "X-API-Key", "documentation": origin + "/agent", "openapi": origin + "/openapi-agent.json", "skill": origin + "/markvault/SKILL.md", "mcp": origin + "/api/mcp", "endpoints": object{"me": "/api/v1/agent/me", "search": "/api/v1/agent/search", "bookmarks": "/api/v1/agent/bookmarks", "bookmark": "/api/v1/agent/bookmarks/:id", "restore_bookmark": "/api/v1/agent/bookmarks/:id/restore", "tags": "/api/v1/agent/tags", "tag": "/api/v1/agent/tags/:id", "chat": "/api/v1/agent/chat"}, "safety": object{"rest": "写操作需要对应的 API Key 权限。", "mcp": "写工具必须明确设置 confirm=true。", "chat": "写操作必须由用户在站内确认。"}}
}
func rpcError(id any, code int, message string) object {
	return object{"jsonrpc": "2.0", "id": id, "error": object{"code": code, "message": message}}
}
func rpcResult(id any, result any) object {
	return object{"jsonrpc": "2.0", "id": id, "result": result}
}
func rpcToolResult(value any, failed bool) object {
	encoded, _ := json.Marshal(value)
	return object{"content": []object{{"type": "text", "text": string(encoded)}}, "structuredContent": value, "isError": failed}
}
func MCP(raw any, host plugin.MCPHost) (any, int, error) {
	requests, batch := raw.([]any)
	if !batch {
		requests = []any{raw}
	}
	if len(requests) == 0 || len(requests) > 100 {
		return rpcError(nil, -32600, "批次需为 1–100 个请求"), 400, nil
	}
	responses := []object{}
	for _, item := range requests {
		request, ok := item.(map[string]any)
		if !ok {
			responses = append(responses, rpcError(nil, -32600, "请求格式无效"))
			continue
		}
		identifier, hasID := request["id"]
		method, validMethod := request["method"].(string)
		if request["jsonrpc"] != "2.0" || !validMethod {
			responses = append(responses, rpcError(identifier, -32600, "请求格式无效"))
			continue
		}
		if !hasID {
			continue
		}
		params, _ := request["params"].(map[string]any)
		var response object
		switch method {
		case "initialize":
			version := str(params["protocolVersion"])
			if version != "2025-06-18" && version != "2025-03-26" && version != "2024-11-05" {
				version = "2025-06-18"
			}
			response = rpcResult(identifier, object{"protocolVersion": version, "capabilities": object{"tools": object{"listChanged": false}}, "serverInfo": object{"name": "markvault", "title": "MarkVault", "version": "1.1.0"}, "instructions": "读取工具可直接调用；写操作需要用户明确确认并设置 confirm=true。"})
		case "ping":
			response = rpcResult(identifier, object{})
		case "tools/list":
			list := []object{}
			definitions, err := host.Tools()
			if err != nil {
				return nil, 500, err
			}
			for _, definition := range definitions {
				if !host.Allowed(definition) {
					continue
				}
				list = append(list, object{"name": definition.Name, "title": definition.Title, "description": definition.Description, "inputSchema": definition.Schema, "annotations": object{"title": definition.Title, "readOnlyHint": !definition.Write, "destructiveHint": definition.Destructive, "idempotentHint": false, "openWorldHint": false}})
			}
			response = rpcResult(identifier, object{"tools": list})
		case "tools/call":
			name := str(params["name"])
			args, ok := params["arguments"].(map[string]any)
			if params["arguments"] == nil {
				args = object{}
				ok = true
			}
			if name == "" || !ok {
				host.InvalidCall(name)
				response = rpcError(identifier, -32602, "工具参数无效")
				break
			}
			result, err := host.Execute(name, args, args["confirm"] == true)
			if err != nil {
				message := host.ErrorMessage(err)
				response = rpcResult(identifier, rpcToolResult(object{"error": message}, true))
			} else {
				response = rpcResult(identifier, rpcToolResult(result, false))
			}
		default:
			response = rpcError(identifier, -32601, "未知方法")
		}
		responses = append(responses, response)
	}
	if len(responses) == 0 {
		return nil, 202, nil
	}
	if !batch {
		return responses[0], 200, nil
	}
	return responses, 200, nil
}
