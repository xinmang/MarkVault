package plugins

import (
	"context"
	"encoding/json"
	"markvault/internal/plugin"
	"strings"
)

type Assistant struct{}

func (Assistant) Pending(call plugin.ModelCall, definition plugin.Tool) object {
	return pendingAction(call, definition)
}
func findDefinition(definitions []plugin.Tool, name string) (plugin.Tool, bool) {
	for _, d := range definitions {
		if d.Name == name {
			return d, true
		}
	}
	return plugin.Tool{}, false
}
func (Assistant) Chat(ctx context.Context, host plugin.AgentHost, settings plugin.ModelSettings, conversation []plugin.Message, rounds int) (object, error) {
	system := AgentSystemPrompt
	if settings.Custom && settings.Prompt != "" {
		system += string(rune(10)) + "用户偏好：" + string(rune(10)) + settings.Prompt
	}
	for round := 0; round < rounds; round++ {
		definitions, err := host.Tools()
		if err != nil {
			return nil, err
		}
		text, calls, err := host.Model(system, conversation, definitions)
		if err != nil {
			return nil, err
		}
		if len(calls) == 0 {
			if text == "" {
				text = "暂时未生成回复，请换一种说法重试。"
			}
			return object{"message": object{"role": "assistant", "content": text}, "pending_actions": []object{}, "model": settings.Model}, nil
		}
		conversation = append(conversation, plugin.Message{Role: "assistant", Content: text, Calls: calls})
		pending := []object{}
		for _, call := range calls {
			definition, ok := findDefinition(definitions, call.Name)
			if !ok {
				conversation = append(conversation, plugin.Message{Role: "tool", CallID: call.ID, Content: `{"error":"未知工具"}`})
				continue
			}
			if definition.Write {
				delete(call.Arguments, "confirm")
				validation := object{}
				for k, v := range call.Arguments {
					validation[k] = v
				}
				validation["confirm"] = true
				if err = host.Validate(validation, definition.Schema, "arguments"); err != nil {
					conversation = append(conversation, plugin.Message{Role: "tool", CallID: call.ID, Content: `{"error":"写操作参数无效"}`})
					continue
				}
				pending = append(pending, pendingAction(call, definition))
				if definition.PluginID != "" {
					pending[len(pending)-1]["plugin_revision"] = definition.Revision
				}
				continue
			}
			result, err := host.Execute(call.Name, call.Arguments)
			if err != nil {
				result = object{"error": "工具执行失败"}
				result["error"] = host.ErrorMessage(err)
			}
			encoded, _ := json.Marshal(result)
			conversation = append(conversation, plugin.Message{Role: "tool", CallID: call.ID, Content: string(encoded)})
		}
		if len(pending) > 0 {
			if err := host.Confirm(pending); err != nil {
				return nil, err
			}
			if text == "" {
				text = "请检查并确认以下操作。"
			}
			return object{"message": object{"role": "assistant", "content": text}, "pending_actions": pending, "model": settings.Model}, nil
		}
	}
	return object{"message": object{"role": "assistant", "content": "本轮工具调用次数已达上限，请缩小问题范围后重试。"}, "pending_actions": []object{}, "model": settings.Model}, nil
}
func firstNonempty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return "待确认操作"
}

// pendingFieldLabels 是确认卡片中列出的改动字段，顺序即展示顺序。
var pendingFieldLabels = []struct{ key, label string }{
	{"title", "标题"}, {"url", "网址"}, {"description", "描述"}, {"tags", "标签"}, {"tag_ids", "标签"}, {"color", "颜色"}, {"icon", "图标"},
}

// pendingAction 生成确认卡片。模型给出的参数可能来自被注入的网页内容，
// 因此卡片必须写明会改动哪些字段；公开书签会让任何人都能看到，按危险操作要求确认。
func pendingAction(call plugin.ModelCall, definition plugin.Tool) object {
	args := call.Arguments
	destructive := definition.Destructive
	changes := []string{}
	if strings.HasPrefix(definition.Name, "markvault_update_") {
		seen := map[string]bool{}
		for _, field := range pendingFieldLabels {
			if _, ok := args[field.key]; ok && !seen[field.label] {
				seen[field.label] = true
				changes = append(changes, "修改"+field.label)
			}
		}
	}
	for _, flag := range []struct{ key, on, off string }{
		{"is_public", "设为公开（任何人可通过公开页查看）", "设为私密"},
		{"is_pinned", "置顶", "取消置顶"},
		{"is_archived", "归档", "取消归档"},
	} {
		value, ok := args[flag.key].(bool)
		if !ok {
			continue
		}
		if value {
			changes = append(changes, flag.on)
		} else {
			changes = append(changes, flag.off)
		}
		if flag.key == "is_public" && value {
			destructive = true
		}
	}
	// 备注正文直接展示在卡片上，用户确认的是将要写入的原文。
	if content, ok := args["content"].(string); ok && content != "" {
		text := []rune(content)
		if len(text) > 120 {
			text = append(text[:120], '…')
		}
		changes = append(changes, "备注内容："+string(text))
	}
	summary := definition.Title + "：" + firstNonempty(str(args["title"]), str(args["name"]), str(args["id"]), str(args["url"]))
	if len(changes) > 0 {
		summary += "（" + strings.Join(changes, "、") + "）"
	}
	return object{"id": call.ID, "name": call.Name, "title": definition.Title, "summary": summary, "destructive": destructive, "arguments": args}
}
