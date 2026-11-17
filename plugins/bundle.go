package plugins

import "markvault/internal/plugin"

func Bundle() plugin.Bundle {
	return plugin.Bundle{ImageHosting: HTTPImageHosting{}, Manifests: Builtins(), Policy: Policy(), Samples: Samples(), Providers: ModelProviders, Model: ModelAdapter{}, Agent: Assistant{}, Tools: Tools, RunTool: RunTool, MCP: MCP, Capabilities: AgentCapabilities, SystemPrompt: AgentSystemPrompt}
}
