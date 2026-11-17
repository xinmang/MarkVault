package server

import "testing"

// 旧实现静默截断 page_size；设置页「清理全部快照」会直接请求 page_size=1000。
func TestPageSizeIsClampedNotRejected(t *testing.T) {
	f := setup(t)
	token, _ := f.account("alice")
	for _, path := range []string{"https://example.com/1", "https://example.com/2", "https://example.com/3"} {
		check(t, f.request("POST", "/api/v1/bookmarks", token, object{"title": path, "url": path}), 201)
	}
	list := data(t, f.request("GET", "/api/v1/bookmarks?page=1&page_size=1000", token, nil), 200)
	if len(list["bookmarks"].([]any)) != 3 || list["meta"].(map[string]any)["page_size"] != float64(200) {
		t.Fatalf("书签 page_size 未截断到 200: %v", list["meta"])
	}
	fallback := data(t, f.request("GET", "/api/v1/bookmarks?page_size=abc", token, nil), 200)
	if fallback["meta"].(map[string]any)["page_size"] != float64(100) {
		t.Fatalf("非法 page_size 未回退默认值: %v", fallback["meta"])
	}
	groups := data(t, f.request("GET", "/api/v1/tab-groups?page_size=1000", token, nil), 200)
	if groups["meta"].(map[string]any)["page_size"] != float64(100) {
		t.Fatalf("标签页组 page_size 未截断到 100: %v", groups["meta"])
	}
}
