package plugins

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"markvault/internal/plugin"
	"net/http"
	"strings"
)

type ModelAdapter struct{}
type object = map[string]any

func str(v any) string { s, _ := v.(string); return s }
func modelSchema(schema object) object {
	raw, _ := json.Marshal(schema)
	var cloned object
	_ = json.Unmarshal(raw, &cloned)
	if properties, ok := cloned["properties"].(map[string]any); ok {
		delete(properties, "confirm")
	}
	required, _ := cloned["required"].([]any)
	cleaned := []any{}
	for _, key := range required {
		if key != "confirm" {
			cleaned = append(cleaned, key)
		}
	}
	if len(required) > 0 {
		cloned["required"] = cleaned
	}
	return cloned
}
func (ModelAdapter) Chat(ctx context.Context, host plugin.ModelHost, settings plugin.ModelSettings, system string, messages []plugin.Message, definitions []plugin.Tool) (string, []plugin.ModelCall, error) {
	if settings.Key == "" {
		return "", nil, host.Error(400, "尚未配置 AI 密钥")
	}
	rawURL := settings.URL
	if rawURL == "" {
		rawURL = ModelProviders[settings.Provider][0]
	}
	base, err := host.BaseURL(rawURL)
	if err != nil {
		return "", nil, err
	}
	endpoint := "/chat/completions"
	body := object{"model": settings.Model, "max_tokens": 2000, "temperature": 0.2, "stream": false}
	list := []object{}
	toolList := []object{}
	if settings.Provider == "claude" {
		endpoint = "/messages"
		delete(body, "stream")
		body["system"] = system
		for _, message := range messages {
			if message.Role == "tool" {
				list = append(list, object{"role": "user", "content": []object{{"type": "tool_result", "tool_use_id": message.CallID, "content": message.Content}}})
				continue
			}
			if len(message.Calls) > 0 {
				blocks := []object{}
				if message.Content != "" {
					blocks = append(blocks, object{"type": "text", "text": message.Content})
				}
				for _, call := range message.Calls {
					blocks = append(blocks, object{"type": "tool_use", "id": call.ID, "name": call.Name, "input": call.Arguments})
				}
				list = append(list, object{"role": "assistant", "content": blocks})
			} else {
				list = append(list, object{"role": message.Role, "content": message.Content})
			}
		}
		for _, tool := range definitions {
			toolList = append(toolList, object{"name": tool.Name, "description": tool.Description, "input_schema": modelSchema(tool.Schema)})
		}
	} else {
		list = append(list, object{"role": "system", "content": system})
		for _, message := range messages {
			row := object{"role": message.Role, "content": message.Content}
			if message.Role == "tool" {
				row["tool_call_id"] = message.CallID
			}
			if len(message.Calls) > 0 {
				calls := []object{}
				for _, call := range message.Calls {
					encoded, _ := json.Marshal(call.Arguments)
					calls = append(calls, object{"id": call.ID, "type": "function", "function": object{"name": call.Name, "arguments": string(encoded)}})
				}
				row["tool_calls"] = calls
			}
			list = append(list, row)
		}
		for _, tool := range definitions {
			toolList = append(toolList, object{"type": "function", "function": object{"name": tool.Name, "description": tool.Description, "parameters": modelSchema(tool.Schema)}})
		}
		if len(toolList) > 0 {
			body["tool_choice"] = "auto"
		}
	}
	body["messages"] = list
	if len(toolList) > 0 {
		body["tools"] = toolList
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return "", nil, err
	}
	request, err := http.NewRequestWithContext(ctx, "POST", base+endpoint, bytes.NewReader(encoded))
	if err != nil {
		return "", nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	if settings.Provider == "claude" {
		request.Header.Set("x-api-key", settings.Key)
		request.Header.Set("anthropic-version", "2023-06-01")
	} else {
		request.Header.Set("Authorization", "Bearer "+settings.Key)
	}
	client := host.Client()
	defer client.CloseIdleConnections()
	response, err := client.Do(request)
	if err != nil {
		return "", nil, host.Error(502, "AI 服务连接失败或请求超时")
	}
	defer response.Body.Close()
	content, err := io.ReadAll(io.LimitReader(response.Body, 4<<20+1))
	if err != nil {
		return "", nil, host.Error(502, "无法读取 AI 响应")
	}
	if len(content) > 4<<20 {
		return "", nil, host.Error(502, "AI 响应过大")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", nil, host.Error(502, "AI 服务返回错误，请检查模型、密钥和 API 地址")
	}
	var decoded object
	if json.Unmarshal(content, &decoded) != nil {
		return "", nil, host.Error(502, "AI 服务返回了无效 JSON")
	}
	text := ""
	calls := []plugin.ModelCall{}
	if settings.Provider == "claude" {
		blocks, ok := decoded["content"].([]any)
		if !ok {
			return "", nil, host.Error(502, "AI 响应缺少内容")
		}
		for _, value := range blocks {
			block, ok := value.(map[string]any)
			if !ok {
				continue
			}
			if block["type"] == "text" {
				text += str(block["text"]) + "\n"
			}
			if block["type"] == "tool_use" {
				args, _ := block["input"].(map[string]any)
				if args == nil {
					args = object{}
				}
				calls = append(calls, plugin.ModelCall{ID: str(block["id"]), Name: str(block["name"]), Arguments: args})
			}
		}
	} else {
		choices, ok := decoded["choices"].([]any)
		if !ok || len(choices) == 0 {
			return "", nil, host.Error(502, "AI 响应缺少消息")
		}
		choice, ok := choices[0].(map[string]any)
		if !ok {
			return "", nil, host.Error(502, "AI 响应消息无效")
		}
		message, ok := choice["message"].(map[string]any)
		if !ok {
			return "", nil, host.Error(502, "AI 响应消息无效")
		}
		text = str(message["content"])
		rawCalls, _ := message["tool_calls"].([]any)
		for _, value := range rawCalls {
			item, ok := value.(map[string]any)
			if !ok {
				return "", nil, host.Error(502, "AI 工具调用无效")
			}
			fn, _ := item["function"].(map[string]any)
			args := object{}
			if json.Unmarshal([]byte(str(fn["arguments"])), &args) != nil || args == nil {
				return "", nil, host.Error(502, "AI 工具参数无效")
			}
			calls = append(calls, plugin.ModelCall{ID: str(item["id"]), Name: str(fn["name"]), Arguments: args})
		}
	}
	if len(calls) > 20 {
		return "", nil, host.Error(502, "AI 单轮工具调用过多")
	}
	for i := range calls {
		if calls[i].ID == "" {
			calls[i].ID = host.NewID()
		}
	}
	return strings.TrimSpace(text), calls, nil
}

func (ModelAdapter) Models(ctx context.Context, host plugin.ModelHost, settings plugin.ModelSettings) ([]string, error) {
	rawURL := settings.URL
	if rawURL == "" {
		rawURL = ModelProviders[settings.Provider][0]
	}
	base, err := host.BaseURL(rawURL)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, "GET", base+"/models", nil)
	if err != nil {
		return nil, err
	}
	if settings.Provider == "claude" {
		req.Header.Set("x-api-key", settings.Key)
		req.Header.Set("anthropic-version", "2023-06-01")
	} else {
		req.Header.Set("Authorization", "Bearer "+settings.Key)
	}
	client := host.Client()
	defer client.CloseIdleConnections()
	resp, err := client.Do(req)
	if err != nil {
		return nil, host.Error(502, "模型列表连接失败")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, host.Error(502, "模型列表请求失败")
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20+1))
	if err != nil || len(raw) > 4<<20 {
		return nil, host.Error(502, "模型列表响应过大")
	}
	var result struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if json.Unmarshal(raw, &result) != nil {
		return nil, host.Error(502, "模型列表无效")
	}
	names := []string{}
	for _, item := range result.Data {
		if item.ID != "" {
			names = append(names, item.ID)
		}
	}
	return names, nil
}
