package plugins

import (
	"testing"

	"markvault/internal/plugin"
)

func TestBrowserExtensionBuiltin(t *testing.T) {
	manifest, ok := Builtins()["markvault.browser-extension"]
	if !ok {
		t.Fatal("浏览器扩展必须注册到内置插件目录")
	}
	if len(manifest.Permissions) != 0 || len(manifest.Contributes) != 1 || manifest.Contributes[0].Kind != "page" {
		t.Fatal("浏览器扩展下载入口应作为无额外权限的页面插件")
	}
}

func TestBuiltinRegistryIsConsistent(t *testing.T) {
	manifests := Builtins()
	if len(manifests) != len(builtins) {
		t.Fatal("内置插件 ID 重复")
	}
	for id, manifest := range manifests {
		// 内置实现由宿主直接装配，不走第三方贡献的入口与动效约束，这里只核对展示信息和设置结构。
		if !plugin.IDPattern.MatchString(id) || len(manifest.Contributes) != 1 || !plugin.Has(plugin.Kinds, manifest.Contributes[0].Kind) {
			t.Fatal("内置清单无效", id)
		}
		if !plugin.Has(plugin.Categories, manifest.Category) || manifest.Icon == "" {
			t.Fatal("内置插件必须声明分类和图标", id)
		}
		if manifest.Settings != nil {
			if err := plugin.CheckSchema(manifest.Settings, 0); err != nil {
				t.Fatal("内置插件的设置结构无效", id, err)
			}
		}
	}
	policy := Policy()
	for id := range policy.Preferences {
		if policy.DefaultDisabled[id] {
			t.Fatal("绑定旧偏好的插件由偏好列决定默认状态，不应再登记为默认停用", id)
		}
	}
	fallbacks := map[string]int{}
	for id, group := range policy.Exclusive {
		if _, ok := manifests[id]; !ok {
			t.Fatal("互斥组引用了不存在的插件", id)
		}
		if policy.Fallback[id] {
			fallbacks[group]++
		}
	}
	for group, count := range fallbacks {
		if count > 1 {
			t.Fatal("互斥组最多一个兜底成员", group)
		}
	}
	for _, id := range []string{"markvault.image-hosting", "markvault.passkey", "markvault.page-speed", "markvault.home-reader", "markvault.tab-board"} {
		if !policy.DefaultDisabled[id] {
			t.Fatal("按需启用的插件不应默认打开", id)
		}
	}
	if others := policy.ExclusivePreferences("experimental_ascii_theme_enabled"); len(others) != 3 {
		t.Fatal("ASCII 主题应与另外三个偏好绑定的界面主题互斥", others)
	}
	if others := policy.ExclusivePreferences("motion_enabled"); len(others) != 0 {
		t.Fatal("不在互斥组内的偏好不应影响其他开关", others)
	}
}
