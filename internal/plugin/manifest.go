// Package plugin 提供独立于 HTTP 与业务实现的插件契约和生命周期。
package plugin

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path"
	"regexp"
	"sort"
	"strings"
)

const APIVersion = "1.0.0"

var IDPattern = regexp.MustCompile(`^[a-z][a-z0-9-]{1,39}\.[a-z][a-z0-9-]{1,59}$`)
var versionPattern = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`)
var localIDPattern = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,47}$`)
var tokenName = regexp.MustCompile(`^--[a-z][a-z0-9-]{0,60}$`)
var tokenValue = regexp.MustCompile(`^[a-zA-Z0-9#(),.% /-]{1,120}$`)

type Contribution struct {
	Animation   *Animation        `json:"animation,omitempty"`
	ID          string            `json:"id"`
	Kind        string            `json:"kind"`
	Title       string            `json:"title"`
	Entry       string            `json:"entry,omitempty"`
	Slot        string            `json:"slot,omitempty"`
	Tokens      map[string]string `json:"tokens,omitempty"`
	InputSchema map[string]any    `json:"inputSchema,omitempty"`
}
type Animation struct {
	Target   string `json:"target"`
	Effect   string `json:"effect"`
	Duration int    `json:"duration"`
}
type Manifest struct {
	ID          string `json:"id"`
	Version     string `json:"version"`
	API         string `json:"api"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Author      string `json:"author"`
	// Category 与 Icon 只影响插件在设置页和插件中心的归类与展示，不授予任何能力。
	Category     string            `json:"category,omitempty"`
	Icon         string            `json:"icon,omitempty"`
	Server       string            `json:"server,omitempty"`
	Dependencies map[string]string `json:"dependencies,omitempty"`
	Permissions  []string          `json:"permissions"`
	Settings     map[string]any    `json:"settings,omitempty"`
	Contributes  []Contribution    `json:"contributes"`
}

var Permissions = []string{"storage.read", "storage.write", "bookmarks.read", "bookmarks.write", "tags.read", "tags.write", "network.fetch", "models.call"}
var Kinds = []string{"theme", "motion", "background", "page", "panel", "action", "provider", "agent", "tool", "mcp"}

// Categories 是设置页与插件中心共用的功能分类。
var Categories = []string{"appearance", "effects", "intelligence", "connections", "insights", "layouts", "other"}
var iconPattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,39}$`)

func Has(values []string, value string) bool {
	for _, v := range values {
		if v == value {
			return true
		}
	}
	return false
}
func SafePath(p string) bool {
	if p == "" || p == "." || len(p) > 240 || strings.ContainsAny(p, "\\:\x00") || strings.HasPrefix(p, "/") || path.Clean(p) != p {
		return false
	}
	for _, part := range strings.Split(p, "/") {
		base := strings.ToUpper(strings.SplitN(part, ".", 2)[0])
		if part == ".." || strings.HasSuffix(part, ".") || strings.HasSuffix(part, " ") || regexp.MustCompile(`^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$`).MatchString(base) {
			return false
		}
	}
	return true
}
func ParseManifest(raw []byte) (Manifest, error) {
	var m Manifest
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if len(raw) > 128<<10 {
		return m, errors.New("清单过大")
	}
	if err := d.Decode(&m); err != nil {
		return m, errors.New("清单结构无效")
	}
	if d.Decode(new(any)) != io.EOF {
		return m, errors.New("清单包含多余内容")
	}
	return m, m.Validate()
}
func (m Manifest) Validate() error {
	if m.Permissions == nil {
		return errors.New("permissions 必须为数组")
	}
	if !IDPattern.MatchString(m.ID) || !versionPattern.MatchString(m.Version) || m.Name == "" || len(m.Name) > 120 || m.Author == "" || len(m.Author) > 120 || len(m.Description) > 2000 {
		return errors.New("插件身份或版本无效")
	}
	if (m.Category != "" && !Has(Categories, m.Category)) || (m.Icon != "" && !iconPattern.MatchString(m.Icon)) {
		return errors.New("分类或图标无效")
	}
	if m.API != "^1.0.0" && m.API != APIVersion {
		return errors.New("插件需要不兼容的宿主 API")
	}
	if m.Server != "" && (!SafePath(m.Server) || !strings.HasSuffix(m.Server, ".js")) {
		return errors.New("服务端入口必须是包内 JavaScript 文件")
	}
	seen := map[string]bool{}
	for _, p := range m.Permissions {
		if !Has(Permissions, p) || seen[p] {
			return errors.New("权限无效或重复")
		}
		seen[p] = true
	}
	for dep, ver := range m.Dependencies {
		if !IDPattern.MatchString(dep) || dep == m.ID || !versionPattern.MatchString(ver) {
			return errors.New("依赖必须指定其他插件的精确版本")
		}
	}
	if len(m.Contributes) == 0 || len(m.Contributes) > 64 {
		return errors.New("贡献数量必须为 1–64")
	}
	seen = map[string]bool{}
	for _, c := range m.Contributes {
		if !localIDPattern.MatchString(c.ID) || !Has(Kinds, c.Kind) || c.Title == "" || len(c.Title) > 120 || seen[c.ID] {
			return errors.New("贡献类型或标识无效、重复")
		}
		seen[c.ID] = true
		if c.Kind == "motion" {
			if c.Animation == nil || !Has([]string{"cards", "buttons", "tags"}, c.Animation.Target) || !Has([]string{"fade", "rise", "pulse"}, c.Animation.Effect) || c.Animation.Duration < 100 || c.Animation.Duration > 2000 {
				return errors.New("动效必须声明宿主支持的目标、效果和时长")
			}
		}
		if c.Entry != "" && !SafePath(c.Entry) {
			return errors.New("界面入口无效")
		}
		if Has([]string{"page", "panel", "background", "action"}, c.Kind) && c.Entry == "" {
			return errors.New("界面贡献缺少入口")
		}
		if Has([]string{"tool", "agent", "provider"}, c.Kind) && m.Server == "" {
			return errors.New("服务端贡献缺少入口")
		}
		for key, value := range c.Tokens {
			if !tokenName.MatchString(key) || !tokenValue.MatchString(value) || strings.Contains(strings.ToLower(value), "url") {
				return errors.New("主题只接受安全设计变量")
			}
		}
		if c.InputSchema != nil {
			if props, ok := c.InputSchema["properties"].(map[string]any); ok {
				if _, reserved := props["confirm"]; reserved {
					return errors.New("confirm 为宿主保留参数")
				}
			}
			if err := CheckSchema(c.InputSchema, 0); err != nil {
				return err
			}
		}
	}
	if m.Settings != nil {
		return CheckSchema(m.Settings, 0)
	}
	return nil
}

// CheckSchema 使用双方均支持的有限 JSON Schema 子集，拒绝无法执行的约束。
func CheckSchema(s map[string]any, depth int) error {
	for _, key := range []string{"minimum", "maximum", "minLength", "maxLength", "maxItems"} {
		if raw, ok := s[key]; ok {
			n, ok := raw.(float64)
			if !ok {
				return errors.New("Schema 数值约束无效")
			}
			if key != "minimum" && key != "maximum" && (n < 0 || n != float64(int64(n))) {
				return errors.New("Schema 长度约束无效")
			}
		}
	}
	if raw, ok := s["additionalProperties"]; ok {
		if _, ok := raw.(bool); !ok {
			return errors.New("additionalProperties 必须为布尔值")
		}
	}
	if raw, ok := s["enum"]; ok {
		if values, ok := raw.([]any); !ok || len(values) == 0 {
			return errors.New("enum 必须为非空数组")
		}
	}
	if depth > 12 {
		return errors.New("设置结构过深")
	}
	for k := range s {
		if !Has([]string{"type", "properties", "required", "additionalProperties", "items", "enum", "title", "description", "default", "minimum", "maximum", "minLength", "maxLength", "maxItems"}, k) {
			return fmt.Errorf("不支持的 Schema 关键字: %s", k)
		}
	}
	kind, _ := s["type"].(string)
	if !Has([]string{"object", "array", "string", "boolean", "integer", "number"}, kind) {
		return errors.New("Schema 必须声明有效类型")
	}
	if props, ok := s["properties"]; ok {
		p, ok := props.(map[string]any)
		if !ok {
			return errors.New("properties 必须为对象")
		}
		for _, v := range p {
			sub, ok := v.(map[string]any)
			if !ok {
				return errors.New("属性 Schema 无效")
			}
			if err := CheckSchema(sub, depth+1); err != nil {
				return err
			}
		}
	}
	if sub, ok := s["items"]; ok {
		v, ok := sub.(map[string]any)
		if !ok {
			return errors.New("items 无效")
		}
		if err := CheckSchema(v, depth+1); err != nil {
			return err
		}
	}
	if required, ok := s["required"]; ok {
		items, ok := required.([]any)
		if !ok {
			return errors.New("required 无效")
		}
		for _, v := range items {
			if _, ok := v.(string); !ok {
				return errors.New("required 无效")
			}
		}
	}
	return nil
}

// Order 为启动提供拓扑顺序，缺失与循环均明确定位，不自动授权依赖。
func Order(manifests map[string]Manifest) ([]string, error) {
	state := map[string]int{}
	order := []string{}
	var visit func(string) error
	visit = func(id string) error {
		if state[id] == 1 {
			return fmt.Errorf("依赖循环: %s", id)
		}
		if state[id] == 2 {
			return nil
		}
		m, ok := manifests[id]
		if !ok {
			return fmt.Errorf("缺少依赖: %s", id)
		}
		state[id] = 1
		keys := []string{}
		for dep := range m.Dependencies {
			keys = append(keys, dep)
		}
		sort.Strings(keys)
		for _, dep := range keys {
			if err := visit(dep); err != nil {
				return err
			}
			if manifests[dep].Version != m.Dependencies[dep] {
				return fmt.Errorf("依赖版本不匹配: %s", dep)
			}
		}
		state[id] = 2
		order = append(order, id)
		return nil
	}
	keys := []string{}
	for id := range manifests {
		keys = append(keys, id)
	}
	sort.Strings(keys)
	for _, id := range keys {
		if err := visit(id); err != nil {
			return nil, err
		}
	}
	return order, nil
}
