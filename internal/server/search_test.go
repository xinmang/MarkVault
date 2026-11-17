package server

import (
	"net/url"
	"testing"
)

// 搜索需同时命中中文标题、描述与标签名，且 keyword 过滤与 search 结果一致。
func TestSearchMatchesChineseContent(t *testing.T) {
	f := setup(t)
	token, _ := f.account("alice")
	tag := data(t, f.request("POST", "/api/v1/tags", token, object{"name": "数据库"}), 201)["tag"].(map[string]any)
	created := data(t, f.request("POST", "/api/v1/bookmarks", token, object{"title": "示例站点", "url": "https://example.com/a", "description": "中文描述", "tag_ids": []string{str(tag["id"])}}), 201)
	if created["bookmark"] == nil {
		t.Fatalf("创建书签失败: %v", created)
	}
	cases := []struct{ name, query string }{
		{"标题", "示例"},
		{"描述", "中文描述"},
		{"网址", "example.com"},
	}
	for _, c := range cases {
		found := data(t, f.request("GET", "/api/v1/search?q="+url.QueryEscape(c.query), token, nil), 200)
		if len(found["results"].(map[string]any)["bookmarks"].([]any)) != 1 {
			t.Errorf("search 未按%s命中: %v", c.name, found["results"])
		}
		list := data(t, f.request("GET", "/api/v1/bookmarks?keyword="+url.QueryEscape(c.query), token, nil), 200)
		if len(list["bookmarks"].([]any)) != 1 {
			t.Errorf("list keyword 未按%s命中: %v", c.name, list["bookmarks"])
		}
	}
	// 标签名只参与全局搜索，列表 keyword 与旧实现一致仅匹配标题/描述/网址。
	byTag := data(t, f.request("GET", "/api/v1/search?q="+url.QueryEscape("数据库"), token, nil), 200)
	if len(byTag["results"].(map[string]any)["bookmarks"].([]any)) != 1 || len(byTag["results"].(map[string]any)["tags"].([]any)) != 1 {
		t.Fatalf("search 未按标签命中: %v", byTag["results"])
	}
	// 通配符必须被转义，不能退化为全量匹配。
	wildcard := data(t, f.request("GET", "/api/v1/search?q="+url.QueryEscape("%"), token, nil), 200)
	if len(wildcard["results"].(map[string]any)["bookmarks"].([]any)) != 0 {
		t.Fatalf("search 未转义通配符: %v", wildcard["results"])
	}
}
