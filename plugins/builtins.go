// Package plugins 由应用入口装配内置实现，插件内核不依赖此包。
package plugins

import "markvault/internal/plugin"

// builtin 是内置插件的唯一登记处：清单、分类、图标、默认状态、旧偏好绑定和互斥关系都从这里派生，
// 宿主（internal/plugin）不再各自维护一份插件名单。
type builtin struct {
	id       string // 不含 markvault. 前缀
	name     string
	kind     string
	category string
	icon     string
	// contribution 为空时与 id 相同
	contribution string
	description  string
	// optIn 的插件默认停用，升级时不会自动打开
	optIn bool
	// preference 把启停绑定到 user_preferences 的布尔列，保持旧设置入口的语义
	preference string
	// exclusive 相同的插件互斥：启用其中一个会停用同组的其他插件
	exclusive string
	// fallback 表示互斥组里的兜底成员：启用别的成员时它保持原状，其他成员都停用后由它生效
	fallback    bool
	permissions []string
	settings    map[string]any
}

// InterfaceThemeGroup 是界面主题的互斥组。经典主题是组内兜底，其余主题同一时间只启用一个。
const InterfaceThemeGroup = "interface-theme"

var asciiSettings = map[string]any{"type": "object", "additionalProperties": false, "properties": map[string]any{
	"boot":       map[string]any{"type": "boolean", "default": true, "title": "启动序列 / Boot sequence", "description": "进入页面时播放终端启动与字符扩散动画，每个浏览器会话一次 / Play the terminal boot and character reveal once per browser session."},
	"background": map[string]any{"type": "string", "enum": []any{"field", "rain", "off"}, "default": "field", "title": "字符背景 / Character background", "description": "field 为随指针起伏的字符场，rain 为下落的字符雨，off 关闭 / A drifting character field, falling glyph rain, or none."},
	"scanlines":  map[string]any{"type": "boolean", "default": true, "title": "扫描线 / Scanlines", "description": "在画面上叠加细微的显像管扫描线 / Overlay faint CRT scanlines."},
	"glitch":     map[string]any{"type": "boolean", "default": true, "title": "故障闪烁 / Glitch flicker", "description": "切换页面和悬停标题时出现短暂的横向错位 / Brief horizontal tearing on navigation and heading hover."},
	// 数值约束使用 float64，与 JSON 解码后的清单以及配置校验保持同一类型
	"density": map[string]any{"type": "integer", "minimum": 40.0, "maximum": 160.0, "default": 100.0, "title": "字符密度 / Glyph density", "description": "背景字符的疏密，百分比 / Background glyph density in percent."},
}}

// liquidGlassSettings 的默认值与 plugins/builtin/liquid-glass/settings.ts 保持一致。
var liquidGlassSettings = map[string]any{"type": "object", "additionalProperties": false, "properties": map[string]any{
	"droplet":   map[string]any{"type": "boolean", "default": true, "title": "指针水滴 / Pointer droplet", "description": "指针带一颗玻璃水滴，靠近按钮时被吸附并与按钮融合；相邻的按钮也会连成一片 / A glass droplet follows the pointer, snaps to nearby buttons and fuses with them; neighbouring buttons blend together too."},
	"highlight": map[string]any{"type": "boolean", "default": true, "title": "流动高光 / Specular highlights", "description": "玻璃边缘的高光随指针位置移动 / Rim highlights shift with the pointer position."},
	// 数值约束使用 float64，与 JSON 解码后的清单以及配置校验保持同一类型
	"frost":  map[string]any{"type": "integer", "minimum": 4.0, "maximum": 40.0, "default": 18.0, "title": "磨砂强度 / Frost", "description": "玻璃背后内容的模糊程度，像素 / How strongly content behind the glass is blurred, in pixels."},
	"fusion": map[string]any{"type": "integer", "minimum": 40.0, "maximum": 160.0, "default": 100.0, "title": "融合范围 / Fusion range", "description": "水滴与按钮开始拉丝融合的距离，百分比 / How far apart droplets and buttons start to bridge, in percent."},
}}

var builtins = []builtin{
	{id: "classic", name: "经典主题 / Classic", kind: "theme", category: "appearance", icon: "panel-top", exclusive: InterfaceThemeGroup, fallback: true},
	{id: "vibehub", name: "VibeHub", kind: "theme", category: "appearance", icon: "sparkles", preference: "experimental_vibehub_theme_enabled", exclusive: InterfaceThemeGroup},
	{id: "uiux-pro", name: "UI/UX Pro", kind: "theme", category: "appearance", icon: "palette", preference: "experimental_uiux_pro_theme_enabled", exclusive: InterfaceThemeGroup},
	{id: "ascii", name: "ASCII 终端 / ASCII terminal", kind: "theme", category: "appearance", icon: "terminal", preference: "experimental_ascii_theme_enabled", exclusive: InterfaceThemeGroup, settings: asciiSettings,
		description: "边框、按钮、背景和动画都用字符绘制的终端风格界面 / A terminal-style interface whose borders, buttons, background and motion are drawn with characters."},
	{id: "liquid-glass", name: "液态玻璃 / Liquid Glass", kind: "theme", category: "appearance", icon: "droplets", preference: "experimental_liquid_glass_theme_enabled", exclusive: InterfaceThemeGroup, settings: liquidGlassSettings,
		description: "半透明的玻璃材质界面，按钮与指针水滴靠近时互相吸附、拉丝融合 / A translucent glass interface whose buttons and pointer droplet attract and fuse like metaballs."},
	{id: "palettes", name: "配色方案 / Palettes", kind: "theme", category: "appearance", icon: "swatch-book"},
	{id: "animated-icons", name: "动态图标 / Animated icons", kind: "motion", category: "appearance", icon: "loader"},
	{id: "motion", name: "交互动效 / Motion", kind: "motion", category: "effects", icon: "activity", preference: "motion_enabled"},
	{id: "theme-transition", name: "主题切换 / Theme transition", kind: "motion", category: "effects", icon: "sun-moon"},
	{id: "ocean", name: "海洋背景 / Ocean", kind: "background", category: "effects", icon: "waves"},
	{id: "cursor", name: "光标效果 / Cursor", kind: "motion", category: "effects", icon: "mouse-pointer"},
	{id: "tag-heat", name: "标签热度 / Tag heat", kind: "motion", category: "effects", icon: "flame", preference: "experimental_tag_heat_enabled"},
	{id: "hover-card", name: "悬浮卡片 / Hover cards", kind: "motion", category: "effects", icon: "gallery-vertical-end", preference: "experimental_hover_card_enabled"},
	{id: "url-privacy", name: "URL 隐私 / URL privacy", kind: "motion", category: "effects", icon: "eye-off", preference: "experimental_url_privacy_enabled"},
	{id: "agent", name: "站内助手 / Assistant", kind: "agent", category: "intelligence", icon: "bot", contribution: "assistant"},
	{id: "models", name: "模型供应商 / Model providers", kind: "provider", category: "intelligence", icon: "cpu"},
	{id: "tools", name: "书签与标签工具 / Tools", kind: "tool", category: "intelligence", icon: "wrench"},
	{id: "agent-api", name: "Agent REST API", kind: "agent", category: "connections", icon: "key"},
	{id: "mcp-server", name: "MCP 服务 / MCP server", kind: "mcp", category: "connections", icon: "server", contribution: "server"},
	{id: "mcp-client", name: "外部 MCP / External MCP", kind: "mcp", category: "connections", icon: "cable", contribution: "client"},
	{id: "image-hosting", name: "图床 / Image hosting", kind: "panel", category: "connections", icon: "image-up", optIn: true, permissions: []string{"network.fetch"},
		description: "按用途将截图、快照图片、封面、网站图标和自定义默认图上传到图床 / Route selected image types to your image host.",
		settings: map[string]any{"type": "object", "additionalProperties": false, "properties": map[string]any{
			"backend": map[string]any{"type": "string", "enum": []any{"http", "s3"}},
			"bucket":  map[string]any{"type": "string"}, "region": map[string]any{"type": "string"},
			"prefix": map[string]any{"type": "string"}, "publicURL": map[string]any{"type": "string"},
			"pathStyle": map[string]any{"type": "boolean"},
			"endpoint":  map[string]any{"type": "string"}, "fileField": map[string]any{"type": "string"},
			"urlPath": map[string]any{"type": "string"}, "authHeader": map[string]any{"type": "string"},
			"purposes": map[string]any{"type": "array", "items": map[string]any{"type": "string", "enum": []any{"screenshot", "snapshot", "cover", "favicon", "default"}}},
		}}},
	{id: "browser-extension", name: "浏览器扩展 / Browser extension", kind: "page", category: "connections", icon: "chrome"},
	{id: "passkey", name: "通行密钥 / Passkey", kind: "panel", category: "connections", icon: "fingerprint", optIn: true},
	{id: "statistics", name: "图表统计 / Statistics", kind: "page", category: "insights", icon: "bar-chart",
		description: "书签访问趋势、热力图、标签页统计与 Agent 调用分析 / Bookmark trends, heatmaps, tab statistics and Agent usage."},
	{id: "page-speed", name: "页面加载速度 / Page speed", kind: "panel", category: "insights", icon: "gauge", optIn: true},
	{id: "view-gallery", name: "画廊视图 / Gallery view", kind: "panel", category: "layouts", icon: "images", optIn: true},
	{id: "view-timeline", name: "时间线视图 / Timeline view", kind: "panel", category: "layouts", icon: "history", optIn: true},
	{id: "view-domains", name: "站点分组视图 / Site groups view", kind: "panel", category: "layouts", icon: "globe", optIn: true},
	{id: "view-focus", name: "专注视图 / Focus view", kind: "panel", category: "layouts", icon: "focus", optIn: true},
	{id: "tag-cloud", name: "标签云 / Tag cloud", kind: "panel", category: "layouts", icon: "cloud", optIn: true},
	{id: "tag-bars", name: "标签排行 / Tag ranking", kind: "panel", category: "layouts", icon: "align-left", optIn: true},
	{id: "tab-board", name: "标签页看板 / Tab board", kind: "panel", category: "layouts", icon: "columns", optIn: true},
	{id: "tab-compact", name: "标签页折叠列表 / Compact tab list", kind: "panel", category: "layouts", icon: "list-collapse", optIn: true},
	{id: "home-topbar", name: "首页顶栏版式 / Home top bar layout", kind: "theme", category: "appearance", icon: "layout-template", optIn: true},
	{id: "home-launchpad", name: "首页起始页版式 / Home launchpad layout", kind: "theme", category: "appearance", icon: "layout-template", optIn: true},
	{id: "home-reader", name: "首页三栏版式 / Home three-pane layout", kind: "theme", category: "appearance", icon: "layout-template", optIn: true},
	{id: "home-tagboard", name: "首页标签看板 / Home tag board layout", kind: "theme", category: "appearance", icon: "layout-template", optIn: true},
	{id: "tabs-tabbed", name: "标签页组顶部分组栏 / Tab groups top strip layout", kind: "theme", category: "appearance", icon: "layout-template", optIn: true},
	{id: "tabs-wall", name: "标签页组卡片墙 / Tab groups card wall layout", kind: "theme", category: "appearance", icon: "layout-template", optIn: true},
	{id: "home-canvas", name: "首页无限画布 / Home infinite canvas layout", kind: "theme", category: "appearance", icon: "infinity", optIn: true},
	{id: "tabs-timeline", name: "标签页组收纳时间线 / Tab groups timeline layout", kind: "theme", category: "appearance", icon: "layout-template", optIn: true},
	{id: "tabs-canvas", name: "标签页组无限画布 / Tab groups infinite canvas layout", kind: "theme", category: "appearance", icon: "infinity", optIn: true},
}

// PreferenceBindings 把内置插件的启停绑定到旧偏好列。
var PreferenceBindings = collect(func(b builtin) (string, bool) { return b.preference, b.preference != "" })

// ExclusiveGroups 记录每个内置插件所属的互斥组。
var ExclusiveGroups = collect(func(b builtin) (string, bool) { return b.exclusive, b.exclusive != "" })

// Policy 是宿主需要的内置插件策略：默认状态、旧偏好绑定与互斥关系。
func Policy() plugin.Policy {
	policy := plugin.Policy{Preferences: PreferenceBindings, Exclusive: ExclusiveGroups, DefaultDisabled: map[string]bool{}, Fallback: map[string]bool{}}
	for _, b := range builtins {
		if b.optIn {
			policy.DefaultDisabled["markvault."+b.id] = true
		}
		if b.fallback {
			policy.Fallback["markvault."+b.id] = true
		}
	}
	return policy
}

func collect(pick func(builtin) (string, bool)) map[string]string {
	result := map[string]string{}
	for _, b := range builtins {
		if value, ok := pick(b); ok {
			result["markvault."+b.id] = value
		}
	}
	return result
}

func Builtins() map[string]plugin.Manifest {
	result := map[string]plugin.Manifest{}
	for _, b := range builtins {
		id := "markvault." + b.id
		contribution := b.contribution
		if contribution == "" {
			contribution = b.id
		}
		permissions := b.permissions
		if permissions == nil {
			permissions = []string{}
		}
		result[id] = plugin.Manifest{ID: id, Version: "1.0.0", API: "^1.0.0", Name: b.name, Description: b.description, Author: "MarkVault", Category: b.category, Icon: b.icon, Permissions: permissions, Settings: b.settings, Contributes: []plugin.Contribution{{ID: contribution, Kind: b.kind, Title: b.name}}}
	}
	return result
}
