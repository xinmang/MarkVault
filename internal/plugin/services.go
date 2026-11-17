package plugin

import (
	"context"
	"net/http"
	"net/url"
)

type ModelSettings struct {
	Provider          string `json:"provider"`
	URL               string `json:"apiUrl"`
	Model             string `json:"model"`
	Prompt            string `json:"customPrompt"`
	Custom            bool   `json:"enableCustomPrompt"`
	Enabled           bool   `json:"enabled"`
	HasKey            bool   `json:"hasApiKey"`
	HasPluginProvider bool   `json:"hasPluginProvider"`
	Created           any    `json:"createdAt"`
	Updated           any    `json:"updatedAt"`
	Key               string `json:"-"`
}
type ModelCall struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Arguments map[string]any `json:"arguments"`
}
type Message struct {
	Role    string      `json:"role"`
	Content string      `json:"content"`
	CallID  string      `json:"callId,omitempty"`
	Calls   []ModelCall `json:"calls,omitempty"`
}
type Tool struct {
	PluginID    string         `json:"pluginId,omitempty"`
	Revision    string         `json:"-"`
	Name        string         `json:"name"`
	Title       string         `json:"title"`
	Description string         `json:"description"`
	Schema      map[string]any `json:"inputSchema"`
	Permission  string         `json:"requiredPermission"`
	Write       bool           `json:"write"`
	Destructive bool           `json:"destructive"`
}

// ModelHost 只提供经过宿主策略校验的网络能力。
type ModelHost struct {
	BaseURL func(string) (string, error)
	Client  func() *http.Client
	Error   func(int, string) error
	NewID   func() string
}
type ModelProvider interface {
	Chat(context.Context, ModelHost, ModelSettings, string, []Message, []Tool) (string, []ModelCall, error)
	Models(context.Context, ModelHost, ModelSettings) ([]string, error)
}
type AgentHost struct {
	Tools        func() ([]Tool, error)
	Model        func(string, []Message, []Tool) (string, []ModelCall, error)
	Execute      func(string, map[string]any) (map[string]any, error)
	Validate     func(any, map[string]any, string) error
	Confirm      func([]map[string]any) error
	ErrorMessage func(error) string
}
type Agent interface {
	Chat(context.Context, AgentHost, ModelSettings, []Message, int) (map[string]any, error)
	Pending(ModelCall, Tool) map[string]any
}
type BusinessRequest struct {
	Operation string
	Body      map[string]any
	Query     url.Values
	ID        string
}
type MCPHost struct {
	Tools        func() ([]Tool, error)
	Allowed      func(Tool) bool
	Execute      func(string, map[string]any, bool) (map[string]any, error)
	InvalidCall  func(string)
	ErrorMessage func(error) string
}

// Bundle 在进程入口装配，核心不引用具体实现包。
type Bundle struct {
	ImageHosting ImageHosting
	Manifests    map[string]Manifest
	Policy       Policy
	Samples      map[string]*Package
	Providers    map[string][2]string
	Model        ModelProvider
	Agent        Agent
	Tools        func() []Tool
	RunTool      func(string, map[string]any) (BusinessRequest, error)
	MCP          func(any, MCPHost) (any, int, error)
	Capabilities func(string) map[string]any
	SystemPrompt string
}
